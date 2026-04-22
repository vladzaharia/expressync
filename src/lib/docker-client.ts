import { config } from "./config.ts";
import { logger } from "./utils/logger.ts";

/**
 * Docker client for streaming container logs via Unix socket
 */
export class DockerClient {
  private socketPath: string;
  private containerName: string;

  constructor(
    socketPath: string = config.DOCKER_SOCKET_PATH,
    containerName: string = config.STEVE_CONTAINER_NAME,
  ) {
    this.socketPath = socketPath;
    this.containerName = containerName;
  }

  /**
   * Stream logs from the StEvE container
   * Returns an async generator that yields log lines
   */
  async *streamLogs(
    options: {
      follow?: boolean;
      tail?: number;
      since?: number; // Unix timestamp
    } = {},
  ): AsyncGenerator<string, void, unknown> {
    const { follow = true, tail = 100, since } = options;

    // Build query parameters
    const params = new URLSearchParams({
      follow: follow.toString(),
      stdout: "true",
      stderr: "true",
      tail: tail.toString(),
      timestamps: "true",
    });

    if (since) {
      params.set("since", since.toString());
    }

    const path = `/containers/${this.containerName}/logs?${params.toString()}`;

    logger.debug("Docker", `Streaming logs from ${this.containerName}`, {
      path,
    });

    try {
      // Connect to Docker socket
      const conn = await Deno.connect({
        path: this.socketPath,
        transport: "unix",
      });

      // Send HTTP request
      const request = `GET ${path} HTTP/1.1\r\nHost: localhost\r\n\r\n`;
      await conn.write(new TextEncoder().encode(request));

      // Read response
      const reader = conn.readable.getReader();
      const decoder = new TextDecoder();
      let rawBuffer = new Uint8Array(0);
      let headersParsed = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Append new bytes to raw buffer
          const tmp = new Uint8Array(rawBuffer.length + value.length);
          tmp.set(rawBuffer);
          tmp.set(value, rawBuffer.length);
          rawBuffer = tmp;

          // Parse and validate HTTP headers before processing frames
          if (!headersParsed) {
            // Look for end-of-headers in raw bytes
            const headerStr = decoder.decode(rawBuffer, { stream: true });
            const headerEnd = headerStr.indexOf("\r\n\r\n");
            if (headerEnd !== -1) {
              // Validate HTTP status code
              const headerSection = headerStr.slice(0, headerEnd);
              const statusMatch = headerSection.match(
                /^HTTP\/\d\.\d\s+(\d+)/,
              );
              if (!statusMatch || parseInt(statusMatch[1], 10) >= 400) {
                const statusCode = statusMatch ? statusMatch[1] : "unknown";
                throw new Error(
                  `Docker API returned HTTP ${statusCode} for ${this.containerName}`,
                );
              }

              // Find byte offset of header end
              const headerBytes = new TextEncoder().encode(
                headerStr.slice(0, headerEnd + 4),
              );
              rawBuffer = rawBuffer.slice(headerBytes.length);
              headersParsed = true;
            } else {
              continue;
            }
          }

          // Docker log stream format: 8-byte header + payload
          // Header: [stream_type(1), 0, 0, 0, size(4)]
          while (rawBuffer.length >= 8) {
            const size = (rawBuffer[4] << 24) | (rawBuffer[5] << 16) |
              (rawBuffer[6] << 8) | rawBuffer[7];

            if (rawBuffer.length < 8 + size) break;

            const payload = decoder.decode(rawBuffer.slice(8, 8 + size));
            rawBuffer = rawBuffer.slice(8 + size);

            // Yield each line
            const lines = payload.split("\n").filter((l) => l.trim());
            for (const line of lines) {
              yield line;
            }
          }
        }
      } finally {
        reader.releaseLock();
        conn.close();
      }
    } catch (error) {
      logger.error("Docker", "Failed to stream logs", error as Error);
      throw error;
    }
  }

  /**
   * Check if Docker socket is accessible
   */
  async isAvailable(): Promise<boolean> {
    try {
      const conn = await Deno.connect({
        path: this.socketPath,
        transport: "unix",
      });
      conn.close();
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton instance
export const dockerClient = new DockerClient();
