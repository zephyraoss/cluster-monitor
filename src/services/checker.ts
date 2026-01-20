import type { ComponentHealth, NodeStatus, PodStatus, ComponentConfig, ComponentStatus } from '../types';

const COMPONENTS: ComponentConfig[] = [
  { name: 'hetzner-csi', namespace: 'kube-system', daemonSetName: 'hcloud-csi-node', helmRelease: 'hcloud-csi' },
  { name: 'juicefs', namespace: 'kube-system', daemonSetName: 'juicefs-csi-node', helmRelease: 'juicefs-csi-driver' },
  { name: 'traefik', namespace: 'kube-system', deploymentName: 'traefik', helmRelease: 'traefik', podLabel: 'app.kubernetes.io/name=traefik' },
  { name: 'cert-manager', namespace: 'cert-manager', deploymentName: 'cert-manager', helmRelease: 'cert-manager', podLabel: 'app.kubernetes.io/name=cert-manager' },
  { name: 'mongodb', namespace: 'database', statefulSetName: 'mongodb-ha', helmRelease: 'mongodb-ha', podLabel: 'app.kubernetes.io/component=mongodb' },
  { name: 'valkey', namespace: 'database', statefulSetName: 'valkey-ha-node', helmRelease: 'valkey-ha', podLabel: 'app.kubernetes.io/name=valkey' },
];

let cache: { data: Record<string, ComponentHealth>; timestamp: number } | null = null;
const CACHE_TTL = 30000;

function calculateStatus(ready: number, desired: number): ComponentStatus {
  if (desired === 0) return 'unhealthy';
  if (ready === desired) return 'healthy';
  if (ready > 0) return 'degraded';
  return 'unhealthy';
}

async function kubectlJson<T>(...args: string[]): Promise<T | null> {
  try {
    const proc = Bun.spawn({
      cmd: ['kubectl', '--kubeconfig', process.env.KUBECONFIG || `${process.env.HOME}/.kube/config`, ...args],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = await new Response(proc.stdout).text();
    return JSON.parse(output);
  } catch {
    return null;
  }
}

function formatPodStatus(pod: any): PodStatus {
  const name = pod.metadata?.name || 'unknown';
  const phase = pod.status?.phase || 'Unknown';
  const containerStatuses = pod.status?.containerStatuses || [];
  let ready = '0/0';
  let restarts = 0;
  if (containerStatuses.length > 0) {
    const readyCount = containerStatuses.filter((c: any) => c.ready).length;
    ready = `${readyCount}/${containerStatuses.length}`;
    restarts = containerStatuses.reduce((sum: number, c: any) => sum + (c.restartCount || 0), 0);
  }
  let status = phase;
  if (phase === 'Running' && ready.startsWith('0/')) status = 'Starting';
  return { name, ready, status, restarts, age: '' };
}

export async function getNodes(): Promise<NodeStatus[]> {
  const data = await kubectlJson<{ items: any[] }>('get', 'nodes', '-o', 'json');
  if (!data?.items) return [];
  return data.items.map(node => ({
    name: node.metadata?.name || 'unknown',
    status: (node.status?.conditions?.find((c: any) => c.type === 'Ready')?.status === 'True') ? 'Ready' : 'NotReady',
    roles: extractRoles(node),
    internalIP: getNodeIP(node),
    osImage: node.status?.nodeInfo?.osImage || 'unknown',
    kernelVersion: node.status?.nodeInfo?.kernelVersion || 'unknown',
    age: 'recent',
  }));
}

function extractRoles(node: any): string[] {
  const roles: string[] = [];
  const labels = node.metadata?.labels || {};
  if (labels['node-role.kubernetes.io/master'] === 'true') roles.push('master');
  if (labels['node-role.kubernetes.io/control-plane'] === 'true') roles.push('control-plane');
  if (labels['node-role.kubernetes.io/worker'] === 'true') roles.push('worker');
  if (labels['kubernetes.io/hostname']) roles.push(labels['kubernetes.io/hostname']);
  return roles.length > 0 ? roles : ['worker'];
}

function getNodeIP(node: any): string {
  const addresses = node.status?.addresses || [];
  const internal = addresses.find((a: any) => a.type === 'InternalIP');
  return internal?.address || 'unknown';
}

function filterPodsByLabel(pods: any[], labelKey: string, labelValue: string): any[] {
  return pods.filter(pod => (pod.metadata?.labels || {})[labelKey] === labelValue);
}

export async function checkAllComponents(): Promise<Record<string, ComponentHealth>> {
  const now = Date.now();
  if (cache && (now - cache.timestamp) < CACHE_TTL) return cache.data;

  const [allPods, allDeployments, allDaemonSets, allStatefulSets] = await Promise.all([
    kubectlJson<{ items: any[] }>('get', 'pods', '-A', '-o', 'json'),
    kubectlJson<{ items: any[] }>('get', 'deployments', '-A', '-o', 'json'),
    kubectlJson<{ items: any[] }>('get', 'daemonsets', '-A', '-o', 'json'),
    kubectlJson<{ items: any[] }>('get', 'statefulsets', '-A', '-o', 'json'),
  ]);

  const podsByNamespace: Record<string, any[]> = {};
  (allPods?.items || []).forEach((pod: any) => {
    const ns = pod.metadata?.namespace || 'default';
    (podsByNamespace[ns] ||= []).push(pod);
  });

  const results: Record<string, ComponentHealth> = {};

  for (const config of COMPONENTS) {
    let readyReplicas = 0, desiredReplicas = 0, message: string | undefined;
    const pods: PodStatus[] = [];
    const nsPods = podsByNamespace[config.namespace] || [];

    if (config.deploymentName) {
      const deploy = (allDeployments?.items || []).find(
        (d: any) => d.metadata?.name === config.deploymentName && d.metadata?.namespace === config.namespace
      );
      if (deploy) {
        readyReplicas = deploy.status?.readyReplicas || 0;
        desiredReplicas = deploy.spec?.replicas || 0;
      } else desiredReplicas = 1;
      if (config.podLabel) {
        const [key, value] = config.podLabel.split('=');
        pods.push(...filterPodsByLabel(nsPods, key, value).map(formatPodStatus));
      }
    }

    if (config.daemonSetName) {
      const ds = (allDaemonSets?.items || []).find(
        (d: any) => d.metadata?.name === config.daemonSetName && d.metadata?.namespace === config.namespace
      );
      if (ds) {
        desiredReplicas = ds.status?.desiredNumberScheduled || 0;
        readyReplicas = ds.status?.numberReady || 0;
      }
      if (config.podLabel && pods.length === 0) {
        const [key, value] = config.podLabel.split('=');
        pods.push(...filterPodsByLabel(nsPods, key, value).map(formatPodStatus));
      }
    }

    if (config.statefulSetName) {
      const sts = (allStatefulSets?.items || []).find(
        (s: any) => s.metadata?.name === config.statefulSetName && s.metadata?.namespace === config.namespace
      );
      if (sts) {
        readyReplicas = sts.status?.readyReplicas || 0;
        desiredReplicas = sts.spec?.replicas || 0;
      } else desiredReplicas = 1;
      if (config.podLabel && pods.length === 0) {
        const [key, value] = config.podLabel.split('=');
        pods.push(...filterPodsByLabel(nsPods, key, value).map(formatPodStatus));
      }
    }

    if (pods.length > 0 && desiredReplicas === 0) {
      desiredReplicas = pods.length;
      const runningPods = pods.filter(p => p.status === 'Running').length;
      if (runningPods === pods.length) readyReplicas = pods.length;
    }

    const status = calculateStatus(readyReplicas, desiredReplicas);
    if (status === 'degraded') message = `${readyReplicas}/${desiredReplicas} replicas ready`;

    results[config.name] = {
      name: config.name, status, namespace: config.namespace,
      helmRelease: config.helmRelease, readyReplicas, desiredReplicas, pods, message,
    };
  }

  cache = { data: results, timestamp: now };
  return results;
}

export async function checkComponentByName(name: string): Promise<ComponentHealth | null> {
  const components = await checkAllComponents();
  return components[name] || null;
}

export function getComponentNames(): string[] {
  return COMPONENTS.map(c => c.name);
}
