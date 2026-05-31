const { db } = require('./db');

const stmt = db.prepare(`
  INSERT INTO audit_log (actor_id, actor_type, action, entity_type, entity_id, metadata, ip)
  VALUES (@actor_id, @actor_type, @action, @entity_type, @entity_id, @metadata, @ip)
`);

function log({ actor_id = null, actor_type, action, entity_type, entity_id, metadata = null, ip = null }) {
  try {
    stmt.run({
      actor_id,
      actor_type,
      action,
      entity_type,
      entity_id,
      metadata: metadata ? JSON.stringify(metadata) : null,
      ip
    });
  } catch (e) {
    console.error('[audit-log] failed:', e.message);
  }
}

module.exports = { log };
