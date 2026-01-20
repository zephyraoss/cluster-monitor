import type { Request } from 'bun';
import { getNodes, checkAllComponents, checkComponentByName, getComponentNames } from '../services/checker';
import type { ClusterHealth, ApiResponse } from '../types';

function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function calculateOverallStatus(statuses: Record<string, { status: string }>): 'healthy' | 'degraded' | 'unhealthy' {
  const values = Object.values(statuses);
  if (values.length === 0) return 'unhealthy';

  const hasUnhealthy = values.some(s => s.status === 'unhealthy');
  const hasDegraded = values.some(s => s.status === 'degraded');
  const allHealthy = values.every(s => s.status === 'healthy');

  if (hasUnhealthy) return 'unhealthy';
  if (hasDegraded || !allHealthy) return 'degraded';
  return 'healthy';
}

export async function handleHealthApi(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathParts = url.pathname.split('/').filter(Boolean);
  const component = pathParts[pathParts.length - 1];

  const timestamp = new Date().toISOString();

  if (component && component !== 'health') {
    const compResult = await checkComponentByName(component);
    if (!compResult) {
      const errorResponse: ApiResponse = {
        success: false,
        error: `Component '${component}' not found. Available: ${getComponentNames().join(', ')}`,
        timestamp,
      };
      return jsonResponse(errorResponse, 404);
    }

    const response: ApiResponse<typeof compResult> = {
      success: true,
      data: compResult,
      timestamp,
    };
    return jsonResponse(response);
  }

  const [nodes, components] = await Promise.all([
    getNodes(),
    checkAllComponents(),
  ]);

  const readyNodes = nodes.filter(n => n.status === 'Ready').length;
  const overallStatus = calculateOverallStatus(components);

  const clusterHealth: ClusterHealth = {
    timestamp,
    status: overallStatus,
    cluster: {
      nodes,
      totalNodes: nodes.length,
      readyNodes,
    },
    components,
  };

  const response: ApiResponse<ClusterHealth> = {
    success: true,
    data: clusterHealth,
    timestamp,
  };

  return jsonResponse(response);
}

export async function handleNodesApi(): Promise<Response> {
  const nodes = await getNodes();
  const timestamp = new Date().toISOString();

  const response: ApiResponse<typeof nodes> = {
    success: true,
    data: nodes,
    timestamp,
  };

  return jsonResponse(response);
}

export async function handleComponentsList(): Promise<Response> {
  const components = getComponentNames();
  const timestamp = new Date().toISOString();

  const response: ApiResponse<string[]> = {
    success: true,
    data: components,
    timestamp,
  };

  return jsonResponse(response);
}
