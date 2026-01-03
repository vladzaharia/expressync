# Use official Deno image
FROM denoland/deno:2.6.3

# Set working directory
WORKDIR /app

# Copy dependency files
COPY deno.json deno.lock ./

# Copy application code (needed for deno install to work)
COPY . .

# Cache dependencies
RUN deno install

# Build the application
RUN deno task build

# Expose port
EXPOSE 8000

# Run the application
CMD ["deno", "task", "start"]

