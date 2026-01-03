#!/bin/sh
set -e

echo "🚀 Starting OCPP Billing Application..."

# Wait for PostgreSQL to be ready
echo "⏳ Waiting for PostgreSQL to be ready..."
until pg_isready -h postgres -U ocpp_user -d ocpp_billing > /dev/null 2>&1; do
  echo "PostgreSQL is unavailable - sleeping"
  sleep 2
done

echo "✅ PostgreSQL is ready!"

# Run database migrations
echo "🔄 Running database migrations..."
deno task db:migrate

echo "✅ Migrations completed!"

# Start the application
echo "🎯 Starting application..."
exec deno task start

