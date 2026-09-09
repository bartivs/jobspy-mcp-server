import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import express from 'express';
import cors from 'cors';
import logger from './logger.js';
import SseManager from './sseManager.js';
import {
  searchJobsPrompt,
  jobRecommendationsPrompt,
  resumeFeedbackPrompt,
} from './prompts/index.js';
import { searchJobsTool, searchJobsHandler } from './tools/index.js';

const PORT = process.env.JOBSPY_PORT || 9423;
const HOST = process.env.JOBSPY_HOST || '0.0.0.0';
const ENABLE_SSE = !!(process.env.ENABLE_SSE | 0);

const sseManager = new SseManager();
let stdioServer = null;
let stdioTransport = null;
let httpServer = null;

/** Create a fully registered MCP server for one transport connection. */
function createMcpServer() {
  const server = new McpServer({
    name: 'JobSpy MCP Server',
    version: '1.0.0',
    description:
      'A Model Context Protocol server that enables searching for jobs across various platforms',
  });

  searchJobsPrompt(server);
  jobRecommendationsPrompt(server);
  resumeFeedbackPrompt(server);
  searchJobsTool(server, sseManager);
  return server;
}

async function runServer() {
  logger.info('Starting JobSpy MCP server...');

  if (ENABLE_SSE) {
    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    app.get('/health', (req, res) => {
      res.status(200).json({ status: 'ok' });
    });

    app.get('/sse', async (req, res) => {
      const server = createMcpServer();
      const transport = sseManager.createTransport('/messages', res, server);

      res.on('close', () => {
        sseManager.removeTransport(transport.sessionId);
        logger.info(`Client disconnected: ${transport.sessionId}`);
      });

      try {
        await server.connect(transport);
        logger.info(`New SSE client connected: ${transport.sessionId}`);
      } catch (error) {
        sseManager.removeTransport(transport.sessionId);
        logger.error('Failed to connect SSE client', {
          error: error.message,
          stack: error.stack,
        });
        if (!res.headersSent) {
          res.status(500).end();
        }
      }
    });

    app.post('/messages', async (req, res) => {
      const transport = sseManager.getTransport(req);
      if (transport) {
        await transport.handlePostMessage(req, res, req.body);
      } else {
        res.status(400).send('No transport found for sessionId');
      }
    });

    app.post('/api', async (req, res) => {
      try {
        const data = await searchJobsHandler(req.body);
        res.json(data);
      } catch (error) {
        logger.error('Error in /api searchJobsHandler', {
          error: error.message,
        });
        res.status(500).json({ message: error.message });
      }
    });

    httpServer = app.listen(PORT, HOST, () => {
      logger.info(`SSE server listening at http://${HOST}:${PORT}`);
    });

    logger.info(`SSE transport listening at http://${HOST}:${PORT}/sse`);
    logger.info(`Send endpoint available at http://${HOST}:${PORT}/messages`);
    return;
  }

  stdioServer = createMcpServer();
  stdioTransport = new StdioServerTransport();
  await stdioServer.connect(stdioTransport);
  logger.info('Stdio transport connected');
}

async function shutdown() {
  logger.info('Shutting down JobSpy MCP server...');

  try {
    const disconnects = sseManager
      .getServers()
      .map((server) => server.close());
    if (stdioServer) {
      disconnects.push(stdioServer.close());
    }
    await Promise.allSettled(disconnects);

    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
      logger.info('HTTP server closed');
    }

    logger.info('Server shutdown complete');
  } catch (error) {
    logger.error('Error during shutdown', { error: error.message });
  } finally {
    setTimeout(() => process.exit(0), 100);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

runServer().catch((error) => {
  logger.error('Unhandled error in server', { error: error.message });
  process.exit(1);
});
