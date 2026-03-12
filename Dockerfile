FROM python:3.11-slim

WORKDIR /app

# Install dependencies separately to cache the layer
COPY backend/requirements.txt backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy the rest of the application
COPY backend/ backend/
COPY frontend/ frontend/

# Expose port
EXPOSE 8000

# Run the server
WORKDIR /app/backend
CMD ["python", "server.py"]
