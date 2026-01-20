import { serve } from 'bun';
import { handleHealthApi, handleNodesApi, handleComponentsList } from './routes/api';
import { isConfigValid } from './config/k8s';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

function getStatusBadge(status: string): string {
  const colors: Record<string, string> = {
    healthy: '#22c55e',
    degraded: '#eab308',
    unhealthy: '#ef4444',
    Ready: '#22c55e',
    NotReady: '#ef4444',
  };
  const color = colors[status] || '#6b7280';
  return `<span style="background: ${color}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px;">${status}</span>`;
}

function generateDashboard(data: any): string {
  const { cluster, components } = data;

  const nodeRows = cluster.nodes.map((n: any) => `
    <tr>
      <td>${n.name}</td>
      <td>${getStatusBadge(n.status)}</td>
      <td>${n.roles.join(', ')}</td>
      <td>${n.internalIP}</td>
      <td>${n.osImage}</td>
    </tr>
  `).join('');

  const componentRows = Object.entries(components).map(([name, comp]: [string, any]) => `
    <tr>
      <td><strong>${name}</strong></td>
      <td>${getStatusBadge(comp.status)}</td>
      <td>${comp.namespace}</td>
      <td>${comp.readyReplicas}/${comp.desiredReplicas}</td>
      <td>${comp.pods?.length || 0}</td>
      <td>${comp.message || '-'}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>K3s Cluster Health</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { color: #1a1a1a; }
    h2 { color: #333; margin-top: 30px; }
    .status-banner { padding: 15px 20px; border-radius: 8px; margin-bottom: 20px; color: white; font-weight: bold; }
    .healthy { background: #22c55e; }
    .degraded { background: #eab308; color: #1a1a1a; }
    .unhealthy { background: #ef4444; }
    .summary { display: flex; gap: 20px; margin-bottom: 20px; }
    .summary-card { background: white; padding: 15px 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .summary-card strong { font-size: 24px; display: block; }
    .summary-card span { color: #666; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #f9fafb; font-weight: 600; color: #374151; }
    tr:hover { background: #f9fafb; }
    .api-links { margin-top: 30px; padding: 20px; background: white; border-radius: 8px; }
    .api-links a { display: block; margin: 8px 0; color: #2563eb; text-decoration: none; }
    .api-links a:hover { text-decoration: underline; }
    .timestamp { color: #666; font-size: 12px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🏔️ K3s Cluster Health</h1>

    <div class="status-banner ${data.status}">
      Overall Status: ${data.status.toUpperCase()}
    </div>

    <div class="summary">
      <div class="summary-card">
        <strong>${cluster.readyNodes}/${cluster.totalNodes}</strong>
        <span>Nodes Ready</span>
      </div>
      <div class="summary-card">
        <strong>${Object.values(components).filter((c: any) => c.status === 'healthy').length}/${Object.keys(components).length}</strong>
        <span>Components Healthy</span>
      </div>
    </div>

    <h2>📦 Components</h2>
    <table>
      <thead>
        <tr>
          <th>Component</th>
          <th>Status</th>
          <th>Namespace</th>
          <th>Replicas</th>
          <th>Pods</th>
          <th>Message</th>
        </tr>
      </thead>
      <tbody>
        ${componentRows}
      </tbody>
    </table>

    <h2>🖥️ Nodes</h2>
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Status</th>
          <th>Roles</th>
          <th>Internal IP</th>
          <th>OS</th>
        </tr>
      </thead>
      <tbody>
        ${nodeRows}
      </tbody>
    </table>

    <div class="api-links">
      <h3>📡 API Endpoints</h3>
      <a href="/api/health">GET /api/health - Full cluster status</a>
      <a href="/api/health?component=hetzner-csi">GET /api/health/:component - Specific component</a>
      <a href="/api/nodes">GET /api/nodes - Node status only</a>
      <a href="/api/components">GET /api/components - List all components</a>
    </div>

    <p class="timestamp">Last updated: ${data.timestamp}</p>
  </div>
</body>
</html>`;
}

const server = serve({
  port: PORT,
  routes: {
    '/': async (req) => {
      try {
        const [nodes, components] = await Promise.all([
          import('./services/checker').then(m => m.getNodes()),
          import('./services/checker').then(m => m.checkAllComponents()),
        ]);

        const readyNodes = nodes.filter(n => n.status === 'Ready').length;
        const data = {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          cluster: { nodes, totalNodes: nodes.length, readyNodes },
          components,
        };

        return new Response(generateDashboard(data), {
          headers: { 'Content-Type': 'text/html' },
        });
      } catch (error) {
        return new Response(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, {
          status: 500,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    },

    '/api/health': async (req) => {
      return handleHealthApi(req);
    },

    '/api/nodes': async () => {
      return handleNodesApi();
    },

    '/api/components': async () => {
      return handleComponentsList();
    },

    '/health': new Response('OK', { status: 200 }),

    '/favicon.ico': new Response(null, { status: 204 }),
  },

  error(error) {
    console.error('Server error:', error);
    return new Response('Internal Server Error', { status: 500 });
  },
});

console.log(`🚀 K3s Cluster Monitor running at http://localhost:${PORT}`);
console.log(`   Dashboard: http://localhost:${PORT}/`);
console.log(`   API: http://localhost:${PORT}/api/health`);
