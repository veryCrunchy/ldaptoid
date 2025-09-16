// Structured logging service with multiple levels and security features
// Provides consistent logging across all services with proper formatting

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4,
}

export interface LogEntry {
  timestamp: string;
  level: string;
  service: string;
  message: string;
  data?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  requestId?: string;
  userId?: string;
  clientIp?: string;
}

export interface LoggerConfig {
  level: LogLevel;
  service: string;
  enableConsole: boolean;
  enableFile?: boolean;
  filePath?: string;
  redactSensitive: boolean;
  requestIdHeader?: string;
}

export class StructuredLogger {
  private config: LoggerConfig;
  private sensitiveFields = new Set([
    "password",
    "secret",
    "token",
    "key",
    "auth",
    "credential",
    "authorization",
    "x-api-key",
    "client_secret",
    "access_token",
  ]);

  constructor(config: LoggerConfig) {
    this.config = config;
  }

  debug(
    message: string,
    data?: Record<string, unknown>,
    context?: { requestId?: string; userId?: string; clientIp?: string },
  ): void {
    if (this.config.level <= LogLevel.DEBUG) {
      this.log(LogLevel.DEBUG, message, data, context);
    }
  }

  info(
    message: string,
    data?: Record<string, unknown>,
    context?: { requestId?: string; userId?: string; clientIp?: string },
  ): void {
    if (this.config.level <= LogLevel.INFO) {
      this.log(LogLevel.INFO, message, data, context);
    }
  }

  warn(
    message: string,
    data?: Record<string, unknown>,
    context?: { requestId?: string; userId?: string; clientIp?: string },
  ): void {
    if (this.config.level <= LogLevel.WARN) {
      this.log(LogLevel.WARN, message, data, context);
    }
  }

  error(
    message: string,
    error?: Error | unknown,
    data?: Record<string, unknown>,
    context?: { requestId?: string; userId?: string; clientIp?: string },
  ): void {
    if (this.config.level <= LogLevel.ERROR) {
      const errorData = error instanceof Error
        ? {
          name: error.name,
          message: error.message,
          ...(error.stack ? { stack: error.stack } : {}),
        }
        : undefined;

      this.log(LogLevel.ERROR, message, data, context, errorData);
    }
  }

  fatal(
    message: string,
    error?: Error | unknown,
    data?: Record<string, unknown>,
    context?: { requestId?: string; userId?: string; clientIp?: string },
  ): void {
    const errorData = error instanceof Error
      ? {
        name: error.name,
        message: error.message,
        ...(error.stack ? { stack: error.stack } : {}),
      }
      : undefined;

    this.log(LogLevel.FATAL, message, data, context, errorData);
  }

  private log(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
    context?: { requestId?: string; userId?: string; clientIp?: string },
    error?: { name: string; message: string; stack?: string },
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel[level],
      service: this.config.service,
      message,
      ...(context?.requestId ? { requestId: context.requestId } : {}),
      ...(context?.userId ? { userId: context.userId } : {}),
      ...(context?.clientIp ? { clientIp: context.clientIp } : {}),
    };

    if (data) {
      entry.data = this.config.redactSensitive ? this.redactSensitiveData(data) : data;
    }

    if (error) {
      entry.error = error;
    }

    // Remove undefined fields for cleaner output
    Object.keys(entry).forEach((key) => {
      if (entry[key as keyof LogEntry] === undefined) {
        delete entry[key as keyof LogEntry];
      }
    });

    if (this.config.enableConsole) {
      this.logToConsole(level, entry);
    }

    if (this.config.enableFile && this.config.filePath) {
      this.logToFile(entry);
    }
  }

  private logToConsole(level: LogLevel, entry: LogEntry): void {
    const formatted = JSON.stringify(entry);

    switch (level) {
      case LogLevel.DEBUG:
        console.debug(formatted);
        break;
      case LogLevel.INFO:
        console.info(formatted);
        break;
      case LogLevel.WARN:
        console.warn(formatted);
        break;
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        console.error(formatted);
        break;
    }
  }

  private async logToFile(entry: LogEntry): Promise<void> {
    if (!this.config.filePath) return;

    try {
      const logLine = JSON.stringify(entry) + "\n";
      await Deno.writeTextFile(this.config.filePath, logLine, { append: true });
    } catch (error) {
      // Fallback to console if file logging fails
      console.error("Failed to write to log file:", error);
      console.error("Original log entry:", JSON.stringify(entry));
    }
  }

  private redactSensitiveData(data: Record<string, unknown>): Record<string, unknown> {
    const redacted = { ...data };

    const redactRecursive = (obj: Record<string, unknown>): Record<string, unknown> => {
      const result: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase();

        // Check if key contains sensitive information
        const isSensitive = Array.from(this.sensitiveFields).some((field) => lowerKey.includes(field.toLowerCase()));

        if (isSensitive) {
          result[key] = "[REDACTED]";
        } else if (value && typeof value === "object" && !Array.isArray(value)) {
          result[key] = redactRecursive(value as Record<string, unknown>);
        } else {
          result[key] = value;
        }
      }

      return result;
    };

    return redactRecursive(redacted);
  }

  /**
   * Create a child logger with additional context
   */
  child(additionalContext: { service?: string; requestId?: string; userId?: string }): ContextLogger {
    return new ContextLogger(this, additionalContext);
  }

  /**
   * Set log level at runtime
   */
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  /**
   * Add custom sensitive field patterns
   */
  addSensitiveFields(...fields: string[]): void {
    fields.forEach((field) => this.sensitiveFields.add(field.toLowerCase()));
  }
}

/**
 * Context-aware logger that maintains request/user context
 */
export class ContextLogger {
  constructor(
    private parent: StructuredLogger,
    private context: { service?: string; requestId?: string; userId?: string; clientIp?: string },
  ) {}

  debug(message: string, data?: Record<string, unknown>): void {
    this.parent.debug(message, data, this.context);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.parent.info(message, data, this.context);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.parent.warn(message, data, this.context);
  }

  error(message: string, error?: Error | unknown, data?: Record<string, unknown>): void {
    this.parent.error(message, error, data, this.context);
  }

  fatal(message: string, error?: Error | unknown, data?: Record<string, unknown>): void {
    this.parent.fatal(message, error, data, this.context);
  }
}

/**
 * Create a logger instance with environment-based configuration
 */
export function createLogger(service: string): StructuredLogger {
  const level = parseLogLevel(Deno.env.get("LDAPTOID_LOG_LEVEL") || "INFO");
  const verbose = Deno.env.get("LDAPTOID_VERBOSE") === "true";

  return new StructuredLogger({
    level: verbose ? LogLevel.DEBUG : level,
    service,
    enableConsole: true,
    enableFile: false, // Can be enabled with LDAPTOID_LOG_FILE
    redactSensitive: Deno.env.get("LDAPTOID_LOG_REDACT_SENSITIVE") !== "false",
  });
}

function parseLogLevel(levelStr: string): LogLevel {
  switch (levelStr.toUpperCase()) {
    case "DEBUG":
      return LogLevel.DEBUG;
    case "INFO":
      return LogLevel.INFO;
    case "WARN":
    case "WARNING":
      return LogLevel.WARN;
    case "ERROR":
      return LogLevel.ERROR;
    case "FATAL":
      return LogLevel.FATAL;
    default:
      return LogLevel.INFO;
  }
}

export default StructuredLogger;
