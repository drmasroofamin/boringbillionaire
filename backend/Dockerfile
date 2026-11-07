# syntax=docker/dockerfile:1
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN --mount=type=secret,id=proxy_ca,required=false \
    if [ -f /run/secrets/proxy_ca ]; then PIP_CERT=/run/secrets/proxy_ca pip install --no-cache-dir -r requirements.txt; else pip install --no-cache-dir -r requirements.txt; fi
COPY app ./app
COPY migrations ./migrations
COPY alembic.ini entrypoint.sh ./
RUN useradd --create-home app && mkdir uploads && chown -R app:app /app
USER app
EXPOSE 8000
CMD ["sh", "entrypoint.sh"]
