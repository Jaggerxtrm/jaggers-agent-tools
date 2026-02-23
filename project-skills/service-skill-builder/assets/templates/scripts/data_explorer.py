import os
import argparse
import json
import psycopg2
import redis
from typing import Dict, List, Any, Optional

class DataExplorer:
    """Project-agnostic database explorer for microservices."""

    def __init__(self, service_name: str, config: Dict[str, Any]):
        self.service_name = service_name
        self.config = config
        self.env = self._extract_env()
        self.db_type = self._detect_db()

    def _extract_env(self) -> Dict[str, str]:
        """Extract environment variables from config."""
        env = {}
        raw_env = self.config.get("environment", {})
        if isinstance(raw_env, dict):
            env.update({str(k): str(v) for k, v in raw_env.items()})
        elif isinstance(raw_env, list):
            for e in raw_env:
                if "=" in str(e):
                    key, val = str(e).split("=", 1)
                    env[key] = val
        return env

    def _detect_db(self) -> Optional[str]:
        """Identify database type from environment variables."""
        if any(k in self.env for k in ["DATABASE_URL", "POSTGRES_USER", "PGPASSWORD"]):
            return "postgres"
        elif any(k in self.env for k in ["REDIS_URL", "REDIS_HOST", "REDIS_PORT"]):
            return "redis"
        elif any(k in self.env for k in ["MONGO_URL", "MONGODB_URI"]):
            return "mongodb"
        return None

    def list_tables(self) -> List[str]:
        """List tables or collections."""
        if self.db_type == "postgres":
            return self._list_postgres_tables()
        elif self.db_type == "redis":
            return self._list_redis_keys()
        return []

    def _list_postgres_tables(self) -> List[str]:
        """List tables in PostgreSQL."""
        url = self.env.get("DATABASE_URL")
        if not url: return []
        try:
            with psycopg2.connect(url) as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
                    return [r[0] for r in cur.fetchall()]
        except Exception:
            return []

    def _list_redis_keys(self) -> List[str]:
        """List keys in Redis (first 100)."""
        url = self.env.get("REDIS_URL")
        host = self.env.get("REDIS_HOST", "localhost")
        port = int(self.env.get("REDIS_PORT", 6379))
        try:
            r = redis.from_url(url) if url else redis.Redis(host=host, port=port)
            return [k.decode('utf-8') for k in r.keys("*")[:100]]
        except Exception:
            return []

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Data Explorer CLI")
    parser.add_argument("--list", action="store_true", help="List tables/keys")
    args = parser.parse_args()
    
    # Test script will be populated during generation
    explorer = DataExplorer("test-service", {})
    if args.list:
        print(json.dumps(explorer.list_tables(), indent=2))
