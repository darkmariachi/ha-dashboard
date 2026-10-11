import {
  callService as haCallService,
  subscribeEntities,
} from "home-assistant-js-websocket";
import type { Connection, HassEntities, HassServiceTarget } from "home-assistant-js-websocket";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AuthError,
  ConnectError,
  clearCredentials,
  connectWithToken,
  loadCredentials,
  saveCredentials,
} from "./connection";
import { fetchRegistries, REGISTRY_UPDATE_EVENTS } from "./registry";
import type {
  AreaGroup,
  AreaRegistryEntry,
  ConnectionStatus,
  DeviceRegistryEntry,
  EntityRegistryEntry,
  EntityWithArea,
} from "./types";

interface HaContextValue {
  status: ConnectionStatus;
  error: string | null;
  hassUrl: string | null;
  entities: HassEntities;
  areaGroups: AreaGroup[];
  entitiesWithArea: Record<string, EntityWithArea>;
  login: (hassUrl: string, token: string) => Promise<void>;
  logout: () => void;
  callService: (
    domain: string,
    service: string,
    data?: Record<string, unknown>,
    target?: HassServiceTarget,
  ) => Promise<void>;
  /**
   * Turns an HA API path (e.g. "/api/camera_proxy/camera.front_door") into a
   * short-lived, self-authenticating URL safe to drop straight into an
   * <img src>. This is the same "auth/sign_path" websocket command HA's own
   * frontend uses for camera snapshots — it sidesteps CORS entirely, since
   * the browser is just loading an image, not making a fetch() call that
   * needs an Authorization header.
   */
  signPath: (path: string, expireSeconds?: number) => Promise<string>;
  /**
   * Sends a raw websocket command and returns its result — an escape hatch
   * for custom-integration websocket APIs (e.g. Spotcast's `spotcast/player`)
   * that don't fit the entity-state/service-call model the rest of this
   * context covers.
   */
  sendMessage: <T>(message: { type: string } & Record<string, unknown>) => Promise<T>;
  /**
   * Opens a websocket subscription (e.g. `weather/subscribe_forecast`) and
   * resolves to its unsubscribe function. The underlying library re-sends the
   * subscription automatically after a reconnect.
   */
  subscribeMessage: <T>(
    callback: (message: T) => void,
    message: { type: string } & Record<string, unknown>,
  ) => Promise<() => Promise<void>>;
}

const HaContext = createContext<HaContextValue | null>(null);

function friendlyNameOf(entityId: string, attrs: Record<string, unknown>) {
  return (attrs.friendly_name as string) || entityId.split(".").slice(1).join(".");
}

export function HaProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hassUrl, setHassUrl] = useState<string | null>(null);
  const [entities, setEntities] = useState<HassEntities>({});
  const [areas, setAreas] = useState<AreaRegistryEntry[]>([]);
  const [devices, setDevices] = useState<DeviceRegistryEntry[]>([]);
  const [entityRegistry, setEntityRegistry] = useState<EntityRegistryEntry[]>([]);

  const connectionRef = useRef<Connection | null>(null);
  const unsubsRef = useRef<Array<() => void>>([]);

  const teardown = useCallback(() => {
    unsubsRef.current.forEach((unsub) => {
      try {
        unsub();
      } catch {
        /* ignore */
      }
    });
    unsubsRef.current = [];
    connectionRef.current?.close();
    connectionRef.current = null;
  }, []);

  const login = useCallback(
    async (hassUrlRaw: string, token: string) => {
      setStatus("connecting");
      setError(null);
      try {
        const conn = await connectWithToken(hassUrlRaw, token);
        connectionRef.current = conn;

        conn.addEventListener("disconnected", () => setStatus("connecting"));
        conn.addEventListener("ready", () => setStatus("connected"));

        unsubsRef.current.push(subscribeEntities(conn, (ents) => setEntities(ents)));

        const loadRegistries = () =>
          fetchRegistries(conn)
            .then(({ areas: a, devices: d, entities: e }) => {
              setAreas(a);
              setDevices(d);
              setEntityRegistry(e);
            })
            .catch(() => {
              /* registries are best-effort; entities still work without them */
            });

        await loadRegistries();

        for (const eventType of REGISTRY_UPDATE_EVENTS) {
          conn
            .subscribeEvents(() => loadRegistries(), eventType)
            .then((unsub) => unsubsRef.current.push(() => void unsub()))
            .catch(() => {});
        }

        saveCredentials({ hassUrl: hassUrlRaw, token });
        setHassUrl(hassUrlRaw);
        setStatus("connected");
      } catch (err) {
        teardown();
        if (err instanceof AuthError) {
          setStatus("auth-invalid");
          setError(err.message);
        } else if (err instanceof ConnectError) {
          setStatus("error");
          setError(err.message);
        } else {
          setStatus("error");
          setError(err instanceof Error ? err.message : "Unknown connection error.");
        }
        throw err;
      }
    },
    [teardown],
  );

  const logout = useCallback(() => {
    teardown();
    clearCredentials();
    setEntities({});
    setAreas([]);
    setDevices([]);
    setEntityRegistry([]);
    setHassUrl(null);
    setStatus("idle");
  }, [teardown]);

  // Attempt auto-login from saved credentials on first mount.
  useEffect(() => {
    const saved = loadCredentials();
    if (saved) {
      login(saved.hassUrl, saved.token).catch(() => {
        /* surfaced via status/error state already */
      });
    }
    return () => teardown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const callService = useCallback(
    async (
      domain: string,
      service: string,
      data?: Record<string, unknown>,
      target?: HassServiceTarget,
    ) => {
      const conn = connectionRef.current;
      if (!conn) throw new Error("Not connected to Home Assistant.");
      await haCallService(conn, domain, service, data, target);
    },
    [],
  );

  const signPath = useCallback(
    async (path: string, expireSeconds = 30) => {
      const conn = connectionRef.current;
      if (!conn) throw new Error("Not connected to Home Assistant.");
      const result = await conn.sendMessagePromise<{ path: string }>({
        type: "auth/sign_path",
        path,
        expires: expireSeconds,
      });
      return `${hassUrl ?? ""}${result.path}`;
    },
    [hassUrl],
  );

  const sendMessage = useCallback(async <T,>(message: { type: string } & Record<string, unknown>) => {
    const conn = connectionRef.current;
    if (!conn) throw new Error("Not connected to Home Assistant.");
    return conn.sendMessagePromise<T>(message);
  }, []);

  const subscribeMessage = useCallback(
    async <T,>(
      callback: (message: T) => void,
      message: { type: string } & Record<string, unknown>,
    ) => {
      const conn = connectionRef.current;
      if (!conn) throw new Error("Not connected to Home Assistant.");
      return conn.subscribeMessage<T>(callback, message);
    },
    [],
  );

  // Build entity_id -> area map from the registries (mirrors HA frontend logic:
  // entity's own area wins, otherwise fall back to its device's area).
  const entitiesWithArea = useMemo<Record<string, EntityWithArea>>(() => {
    const deviceAreaMap = new Map(devices.map((d) => [d.id, d.area_id]));
    const entityRegMap = new Map(entityRegistry.map((e) => [e.entity_id, e]));
    const areaNameMap = new Map(areas.map((a) => [a.area_id, a.name]));

    const result: Record<string, EntityWithArea> = {};
    for (const [entityId, entity] of Object.entries(entities)) {
      const domain = entityId.split(".")[0];
      const reg = entityRegMap.get(entityId);
      const areaId =
        reg?.area_id ?? (reg?.device_id ? deviceAreaMap.get(reg.device_id) : null) ?? null;
      result[entityId] = {
        entity,
        entityId,
        domain,
        areaId: areaId ?? null,
        areaName: areaId ? (areaNameMap.get(areaId) ?? null) : null,
        deviceId: reg?.device_id ?? null,
        platform: reg?.platform ?? null,
        friendlyName: friendlyNameOf(entityId, entity.attributes),
      };
    }
    return result;
  }, [entities, devices, entityRegistry, areas]);

  const areaGroups = useMemo<AreaGroup[]>(() => {
    const groups = new Map<string, AreaGroup>();
    for (const ent of Object.values(entitiesWithArea)) {
      const key = ent.areaId ?? "__no_area__";
      if (!groups.has(key)) {
        groups.set(key, {
          areaId: ent.areaId,
          name: ent.areaName ?? "Other",
          entities: [],
        });
      }
      groups.get(key)!.entities.push(ent);
    }
    return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [entitiesWithArea]);

  const value = useMemo<HaContextValue>(
    () => ({
      status,
      error,
      hassUrl,
      entities,
      areaGroups,
      entitiesWithArea,
      login,
      logout,
      callService,
      signPath,
      sendMessage,
      subscribeMessage,
    }),
    [
      status,
      error,
      hassUrl,
      entities,
      areaGroups,
      entitiesWithArea,
      login,
      logout,
      callService,
      signPath,
      sendMessage,
      subscribeMessage,
    ],
  );

  return <HaContext.Provider value={value}>{children}</HaContext.Provider>;
}

export function useHa(): HaContextValue {
  const ctx = useContext(HaContext);
  if (!ctx) throw new Error("useHa must be used within a HaProvider");
  return ctx;
}
