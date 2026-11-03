import { createServer } from './server';

const srv = await createServer({ listen: true, jobs: true, onShutdown: () => shutdown('shutdown request') });

let stopping = false;
async function shutdown(reason: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  srv.ctx.log.info({ reason }, 'shutting down');
  await srv.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (e) => srv.ctx.log.error({ err: e }, 'unhandled rejection'));
