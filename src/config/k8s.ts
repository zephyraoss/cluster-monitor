import * as k8s from '@kubernetes/client-node';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const kc = new k8s.KubeConfig();

if (process.env.KUBECONFIG) {
  kc.loadFromFile(process.env.KUBECONFIG);
} else {
  kc.loadFromDefault();
}

const cluster = kc.getCurrentCluster();
const user = kc.getCurrentUser();

const apiServer = cluster?.server || 'https://fubuki.de.zpr.ax:6443';
const caCert = cluster?.certificateAuthorityData ? Buffer.from(cluster.certificateAuthorityData, 'base64') : undefined;
const clientCert = user?.clientCertificateData ? Buffer.from(user.clientCertificateData, 'base64') : undefined;
const clientKey = user?.clientKeyData ? Buffer.from(user.clientKeyData, 'base64') : undefined;

function getRequestOptions(path: string): { url: string; options: RequestInit } {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };

  const token = user?.token;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return {
    url: `${apiServer}${path}`,
    options: {
      method: 'GET',
      headers,
      tls: {
        caCert: caCert ? caCert.toString() : undefined,
        key: clientKey ? clientKey.toString() : undefined,
        cert: clientCert ? clientCert.toString() : undefined,
      },
    },
  };
}

export { getRequestOptions, apiServer };

export function isConfigValid(): boolean {
  return true;
}
