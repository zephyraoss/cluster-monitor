export type ComponentStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface PodStatus {
  name: string;
  ready: string;
  status: string;
  restarts: number;
  age: string;
}

export interface NodeStatus {
  name: string;
  status: 'Ready' | 'NotReady' | string;
  roles: string[];
  internalIP: string;
  osImage: string;
  kernelVersion: string;
  age: string;
}

export interface ComponentHealth {
  name: string;
  status: ComponentStatus;
  namespace: string;
  helmRelease?: string;
  readyReplicas: number;
  desiredReplicas: number;
  pods: PodStatus[];
  message?: string;
}

export interface ClusterHealth {
  timestamp: string;
  status: ComponentStatus;
  cluster: {
    nodes: NodeStatus[];
    totalNodes: number;
    readyNodes: number;
  };
  components: Record<string, ComponentHealth>;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

export interface ComponentConfig {
  name: string;
  namespace: string;
  helmRelease?: string;
  deploymentName?: string;
  daemonSetName?: string;
  statefulSetName?: string;
  podLabel?: string;
}
