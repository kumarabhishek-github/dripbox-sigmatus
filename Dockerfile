# ---- Stage 1: build the frontend ----
FROM node:20-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: backend runtime ----
FROM python:3.12-slim AS backend
WORKDIR /app/backend

# Install Python deps first for better layer caching
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# App code
COPY backend/ ./

# Built frontend, served by the backend at /
COPY --from=frontend /frontend/dist /app/frontend/dist

# SQLite DB + backups live here; mount a volume to persist them
RUN mkdir -p data
VOLUME ["/app/backend/data"]

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
