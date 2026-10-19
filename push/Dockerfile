FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY server.mjs doors.mjs reachability.mjs ./
USER node
EXPOSE 8082
CMD ["node", "server.mjs"]
