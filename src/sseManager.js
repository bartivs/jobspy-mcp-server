import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import logger from './logger.js';

/**
 * Manages SSE server transports for multiple client connections.
 * Each connection owns a separate MCP server instance; MCP Protocol objects
 * cannot be connected to more than one transport at a time.
 */
class SseManager {
  /** @type {Object.<string, SSEServerTransport>} */
  transports = {};

  /** @type {Object.<string, import('@modelcontextprotocol/sdk/server/mcp.js').McpServer>} */
  servers = {};

  /** @type {Object.<string, string|number|undefined>} */
  progressTokens = {};

  /** @type {Object.<string, Object>} */
  toolCalls = {};

  /**
   * Adds a new SSE transport and its dedicated MCP server.
   * @param {string} sendPath - Path for client to send messages to
   * @param {Response} res - Express response object
   * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
   * @returns {SSEServerTransport} The created transport
   */
  createTransport(sendPath, res, server) {
    const transport = new SSEServerTransport(sendPath, res);
    this.transports[transport.sessionId] = transport;
    this.servers[transport.sessionId] = server;
    return transport;
  }

  /**
   * Gets a transport by sessionId.
   * @param {Request} req
   * @returns {SSEServerTransport|undefined}
   */
  getTransport(req) {
    const sessionId = req.query.sessionId;
    this.progressTokens[sessionId] = req.body?.params?._meta?.progressToken;
    return this.transports[sessionId];
  }

  /** Removes a transport and its per-connection state. */
  removeTransport(sessionId) {
    if (this.transports[sessionId]) {
      delete this.transports[sessionId];
      delete this.servers[sessionId];
      delete this.progressTokens[sessionId];
      delete this.toolCalls[sessionId];
      logger.info(`Removed transport for session: ${sessionId}`);
      return true;
    }
    return false;
  }

  /** Sends a progress notification through the connection's own MCP server. */
  async notificationProgress(message, sessionId) {
    const server = this.servers[sessionId];
    if (!server) {
      return;
    }

    await server.server.notification({
      method: 'notifications/progress',
      params: {
        ...message,
        progressToken: this.progressTokens[sessionId],
      },
    });
  }

  hasConnection(sessionId) {
    return Boolean(this.transports[sessionId]);
  }

  getServers() {
    return Object.values(this.servers);
  }

  /** Existing stream-event bookkeeping retained for API compatibility. */
  handleStreamEvent(event, connectionId, toolCallId) {
    if (!event || !event.choices || !event.choices[0]) {
      return;
    }

    const delta = event.choices[0].delta;
    if (delta && delta.tool_calls && delta.tool_calls[0]) {
      const toolCall = delta.tool_calls[0];

      if (!this.toolCalls[connectionId]) {
        this.toolCalls[connectionId] = {};
      }

      if (!this.toolCalls[connectionId][toolCallId]) {
        this.toolCalls[connectionId][toolCallId] = {
          function: { name: '', arguments: '' },
          index: toolCall.index,
          id: toolCallId,
        };
      }

      const currentToolCall = this.toolCalls[connectionId][toolCallId];
      if (toolCall.function) {
        if (toolCall.function.name) {
          currentToolCall.function.name = toolCall.function.name;
        }
        if (toolCall.function.arguments) {
          currentToolCall.function.arguments += toolCall.function.arguments;
        }
      }
    }
  }
}

export default SseManager;
