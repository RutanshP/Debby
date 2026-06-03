# Debby v2 — local dev helpers.
#
# Usage:
#   make install   one-time: python venv + apps/api editable install + npm install
#   make dev       boot FastAPI on :8000 and Next.js on :3000 in parallel
#   make dev-api   FastAPI only
#   make dev-web   Next.js only
#   make test      pytest + jest
#   make build     production Next.js build (type-check)

SHELL := /bin/bash

API_DIR := apps/api
WEB_DIR := apps/web
PY      := $(API_DIR)/.venv/bin/python
UVICORN := $(API_DIR)/.venv/bin/uvicorn

.PHONY: install install-api install-web dev dev-api dev-web test test-api test-web build clean

install: install-api install-web

install-api:
	@if [ ! -d "$(API_DIR)/.venv" ]; then \
	  echo "==> creating venv at $(API_DIR)/.venv"; \
	  python3 -m venv $(API_DIR)/.venv; \
	fi
	@echo "==> installing apps/api deps"
	@$(PY) -m pip install -q --upgrade pip
	@$(PY) -m pip install -q -e "$(API_DIR)[dev]"

install-web:
	@echo "==> installing apps/web deps"
	@cd $(WEB_DIR) && npm install

# Boot both servers in parallel; Ctrl-C kills the whole group cleanly.
dev:
	@command -v $(UVICORN) >/dev/null 2>&1 || { \
	  echo "uvicorn not found at $(UVICORN). Run \`make install\` first."; exit 1; \
	}
	@trap 'kill 0' INT TERM; \
	  ( cd $(API_DIR) && set -a && [ -f .env ] && source .env && set +a && ../../$(UVICORN) main:app --reload --host 127.0.0.1 --port 8000 ) & \
	  ( cd $(WEB_DIR) && npm run dev ) & \
	  wait

dev-api:
	@cd $(API_DIR) && set -a && [ -f .env ] && source .env && set +a && ../../$(UVICORN) main:app --reload --host 127.0.0.1 --port 8000

dev-web:
	@cd $(WEB_DIR) && npm run dev

test: test-api test-web

test-api:
	@cd $(API_DIR) && ../../$(PY) -m pytest -q

test-web:
	@cd $(WEB_DIR) && npm test -- --watch=false

build:
	@cd $(WEB_DIR) && npm run build

clean:
	@rm -rf $(API_DIR)/.venv $(WEB_DIR)/node_modules $(WEB_DIR)/.next
