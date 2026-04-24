const CADDY_ADMIN = process.env.CADDY_ADMIN_URL || "http://localhost:2019";

const ADMIN_HEADERS = {
  "Content-Type": "application/json",
  "Origin": CADDY_ADMIN,
};

export const CaddyService = {
  async init(): Promise<void> {
    const res = await fetch(`${CADDY_ADMIN}/config/apps/http/servers/srv0/routes`, {
      headers: { "Origin": CADDY_ADMIN },
    });
   
    const routes = res.ok ? await res.json() : null;
    if (!Array.isArray(routes)) {
      const putRes = await fetch(`${CADDY_ADMIN}/config/apps/http/servers/srv0/routes`, {
        method: "PUT",
        headers: ADMIN_HEADERS,
        body: JSON.stringify([]),
      });
      if (!putRes.ok) {
        const text = await putRes.text();
        throw new Error(`Caddy init failed (${putRes.status}): ${text}`);
      }
      console.log("[caddy] routes initialised");
    }
  },

  async addRoute(deploymentId: string, containerPort: number): Promise<void> {
    const path = `/deploy/${deploymentId}`;
    const upstreamHost = `host.docker.internal:${containerPort}`;

    const route = {
      match: [{ path: [`${path}*`] }],
      handle: [
        {
          handler: "subroute",
          routes: [
            {
              handle: [
                {
                  handler: "rewrite",
                  strip_path_prefix: path,
                },
                {
                  handler: "reverse_proxy",
                  upstreams: [{ dial: upstreamHost }],
                },
              ],
            },
          ],
        },
      ],
    };

    const res = await fetch(`${CADDY_ADMIN}/config/apps/http/servers/srv0/routes`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify(route),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Caddy route add failed (${res.status}): ${text}`);
    }
  },

  async removeRoute(deploymentId: string): Promise<void> {
    const path = `/deploy/${deploymentId}`;

    const res = await fetch(`${CADDY_ADMIN}/config/apps/http/servers/srv0/routes`, {
      headers: { "Origin": CADDY_ADMIN },
    });
    if (!res.ok) return;

    const routes = (await res.json()) as unknown[];
    const filtered = routes.filter((r: any) => {
      const matches = r?.match?.[0]?.path ?? [];
      return !matches.some((p: string) => p.startsWith(path));
    });

    await fetch(`${CADDY_ADMIN}/config/apps/http/servers/srv0/routes`, {
      method: "PUT",
      headers: ADMIN_HEADERS,
      body: JSON.stringify(filtered),
    });
  },

  getPublicUrl(deploymentId: string): string {
    const host = process.env.DEPLOY_HOST || "localhost";
    return `http://${host}/deploy/${deploymentId}`;
  },
};
