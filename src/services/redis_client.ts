// Redis Persistence Client
// Optional Redis integration for UID/GID mapping persistence and stability

export interface RedisClientOptions {
  host?: string;
  port?: number;
  password?: string;
  database?: number;
  keyPrefix?: string;
  connectTimeoutMs?: number;
  operationTimeoutMs?: number;
}

export interface UidGidMapping {
  uid: number;
  gid: number;
  timestamp: number;
}

export interface RedisHealth {
  connected: boolean;
  lastError?: string;
  lastErrorTime?: number;
  operationCount: number;
  errorCount: number;
}

export class RedisClient {
  private readonly options: Required<RedisClientOptions>;
  private connection?: Deno.TcpConn;
  private isConnected = false;
  private lastError?: string;
  private lastErrorTime?: number;
  private operationCount = 0;
  private errorCount = 0;

  constructor(options: RedisClientOptions = {}) {
    this.options = {
      host: options.host ?? "localhost",
      port: options.port ?? 6379,
      password: options.password ?? "",
      database: options.database ?? 0,
      keyPrefix: options.keyPrefix ?? "ldaptoid:",
      connectTimeoutMs: options.connectTimeoutMs ?? 5000,
      operationTimeoutMs: options.operationTimeoutMs ?? 3000,
    };
  }

  async connect(): Promise<void> {
    try {
      const connectPromise = Deno.connect({
        hostname: this.options.host,
        port: this.options.port,
      });

      // Add timeout to connection attempt
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Connection timeout")), this.options.connectTimeoutMs);
      });

      this.connection = await Promise.race([connectPromise, timeoutPromise]);
      this.isConnected = true;

      // Authenticate if password provided
      if (this.options.password) {
        await this.sendCommand(["AUTH", this.options.password]);
      }

      // Select database if non-zero
      if (this.options.database !== 0) {
        await this.sendCommand(["SELECT", this.options.database.toString()]);
      }
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      try {
        await this.sendCommand(["QUIT"]);
      } catch {
        // Ignore errors during quit
      }

      this.connection.close();
      this.connection = undefined;
    }
    this.isConnected = false;
  }

  async storeMapping(key: string, mapping: UidGidMapping): Promise<void> {
    if (!this.isConnected) {
      throw new Error("Redis client not connected");
    }

    try {
      const redisKey = this.options.keyPrefix + key;
      const value = JSON.stringify(mapping);

      await this.sendCommand(["SET", redisKey, value]);
      this.operationCount++;
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  async getUidGidMapping(key: string): Promise<UidGidMapping | null> {
    if (!this.isConnected) {
      throw new Error("Redis client not connected");
    }

    try {
      const redisKey = this.options.keyPrefix + key;
      const response = await this.sendCommand(["GET", redisKey]);
      this.operationCount++;

      // Parse string response
      const lines = response.split("\r\n");
      if (lines.length > 0 && lines[0]?.startsWith("$")) {
        const length = parseInt(lines[0].substring(1));
        if (length === -1) return null; // Null value
        if (lines.length > 1 && lines[1] !== undefined) {
          return JSON.parse(lines[1]) as UidGidMapping;
        }
      }

      return null;
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  async deleteMapping(key: string): Promise<boolean> {
    if (!this.isConnected) {
      throw new Error("Redis client not connected");
    }

    try {
      const redisKey = this.options.keyPrefix + key;
      const response = await this.sendCommand(["DEL", redisKey]);
      this.operationCount++;

      // Parse integer response
      return response.startsWith(":1");
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  async getAllMappings(): Promise<Map<string, UidGidMapping>> {
    if (!this.isConnected) {
      throw new Error("Redis client not connected");
    }

    try {
      const pattern = this.options.keyPrefix + "*";
      const keysResponse = await this.sendCommand(["KEYS", pattern]);
      this.operationCount++;

      const mappings = new Map<string, UidGidMapping>();

      // Parse array response for keys
      const keys = this.parseArrayResponse(keysResponse);

      if (keys.length === 0) {
        return mappings;
      }

      // Get all values using MGET
      const valuesResponse = await this.sendCommand(["MGET", ...keys]);
      this.operationCount++;

      const values = this.parseArrayResponse(valuesResponse);

      // Combine keys and values
      for (let i = 0; i < keys.length && i < values.length; i++) {
        const key = keys[i];
        const value = values[i];
        if (key && value && value !== "$-1") {
          try {
            const originalKey = key.replace(this.options.keyPrefix, "");
            const mapping = JSON.parse(value) as UidGidMapping;
            mappings.set(originalKey, mapping);
          } catch {
            // Skip malformed entries
          }
        }
      }

      return mappings;
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  async ping(): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }

    try {
      const response = await this.sendCommand(["PING"]);
      this.operationCount++;
      return response.includes("PONG");
    } catch (error) {
      this.handleError(error);
      return false;
    }
  }

  getHealth(): RedisHealth {
    return {
      connected: this.isConnected,
      lastError: this.lastError,
      lastErrorTime: this.lastErrorTime,
      operationCount: this.operationCount,
      errorCount: this.errorCount,
    };
  }

  private async sendCommand(command: string[]): Promise<string> {
    if (!this.connection) {
      throw new Error("Redis connection not available");
    }

    // Build Redis protocol command
    const commandStr = this.buildRedisCommand(command);
    const commandBytes = new TextEncoder().encode(commandStr);

    // Send command with timeout
    const sendPromise = this.connection.write(commandBytes);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Operation timeout")), this.options.operationTimeoutMs);
    });

    await Promise.race([sendPromise, timeoutPromise]);

    // Read response with timeout
    const buffer = new Uint8Array(4096);
    const readPromise = this.connection.read(buffer);

    const bytesRead = await Promise.race([readPromise, timeoutPromise]);

    if (bytesRead === null) {
      throw new Error("Connection closed");
    }

    return new TextDecoder().decode(buffer.slice(0, bytesRead));
  }

  private buildRedisCommand(command: string[]): string {
    let result = `*${command.length}\r\n`;
    for (const arg of command) {
      result += `$${arg.length}\r\n${arg}\r\n`;
    }
    return result;
  }

  private parseArrayResponse(response: string): string[] {
    const lines = response.split("\r\n");
    const results: string[] = [];

    if (lines.length === 0 || !lines[0]?.startsWith("*")) {
      return results;
    }

    const count = parseInt(lines[0].substring(1));
    let lineIndex = 1;

    for (let i = 0; i < count && lineIndex < lines.length; i++) {
      const currentLine = lines[lineIndex];
      if (currentLine?.startsWith("$")) {
        const length = parseInt(currentLine.substring(1));
        lineIndex++;

        if (length >= 0 && lineIndex < lines.length) {
          const valueLine = lines[lineIndex];
          results.push(valueLine || "");
        } else {
          results.push(""); // Null value
        }
        lineIndex++;
      } else {
        lineIndex++;
      }
    }

    return results;
  }

  private handleError(error: unknown): void {
    this.errorCount++;
    this.lastError = error instanceof Error ? error.message : String(error);
    this.lastErrorTime = Date.now();

    // Mark as disconnected on connection errors
    if (this.lastError.includes("Connection") || this.lastError.includes("timeout")) {
      this.isConnected = false;
    }
  }
}

export default RedisClient;
