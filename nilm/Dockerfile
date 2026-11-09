# Unnamed-device detection for the Energy page (app.py). Small and
# CPU-light: one websocket in, simple per-sample maths, SQLite out.
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
ENV TZ=America/Chicago
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
