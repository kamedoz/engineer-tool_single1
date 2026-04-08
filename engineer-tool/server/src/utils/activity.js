import { uid } from "./uid.js";

export async function createNotification(db, {
  userId,
  type,
  title,
  body = "",
  entityType = null,
  entityId = null,
}) {
  if (!userId) return null;
  const id = uid("n_");
  const createdAt = new Date().toISOString();
  await db.query(
    `INSERT INTO notifications (id, user_id, type, title, body, entity_type, entity_id, is_read, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, userId, type, title, body, entityType, entityId, false, createdAt]
  );
  return { id, user_id: userId, type, title, body, entity_type: entityType, entity_id: entityId, is_read: false, created_at: createdAt };
}

export async function createAuditLog(db, {
  actorUserId = null,
  action,
  entityType = null,
  entityId = null,
  summary,
  details = "",
}) {
  const id = uid("al_");
  const createdAt = new Date().toISOString();
  await db.query(
    `INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, summary, details, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, actorUserId, action, entityType, entityId, summary, details, createdAt]
  );
  return { id, actor_user_id: actorUserId, action, entity_type: entityType, entity_id: entityId, summary, details, created_at: createdAt };
}
