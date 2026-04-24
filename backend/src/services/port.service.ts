import { db } from "../db";

const PORT_START = parseInt(process.env.CONTAINER_PORT_START || "4000", 10);

// Transaction prevents two concurrent deploys from reading the same MAX and
// colliding on the same port.
export function allocatePort(): number {
  return db.transaction(() => {
    const row = db
      .prepare(
        `SELECT MAX(container_port) as max_port FROM deployments
         WHERE container_port IS NOT NULL`
      )
      .get() as { max_port: number | null };

    return (row?.max_port ?? PORT_START - 1) + 1;
  })();
}
