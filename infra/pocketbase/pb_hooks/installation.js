module.exports.config = function(app) {
  const envKey = $os.getenv('OMO_STORAGE_KEY'), envGuild = $os.getenv('OMO_GUILD_ID');
  if (envKey || envGuild) return { key: envKey, guild: envGuild };
  const row = new DynamicModel({ guild_id: '', service_key: '' });
  try { app.db().newQuery('SELECT guild_id,service_key FROM omo_installation WHERE id=1').one(row); } catch { return { key: '', guild: '' }; }
  return { key: row.service_key, guild: row.guild_id };
};
module.exports.bind = function(app, guild, key) {
  if (!/^\d{17,20}$/.test(guild) || !/^[a-fA-F0-9]{64}$/.test(key)) throw new ApiError(400, 'Invalid instance binding.');
  app.runInTransaction((tx) => {
    const existing = module.exports.config(tx);
    if (existing.key || existing.guild) {
      if (existing.guild !== guild || !$security.equal(existing.key, key)) throw new ApiError(409, 'Instance already bound. Use its saved profile or a fresh instance.');
      return;
    }
    const count = new DynamicModel({ count: 0 });
    tx.db().newQuery('SELECT count(*) AS count FROM omo_guild WHERE guild_id != {:guild}').bind({ guild }).one(count);
    if (count.count) throw new ApiError(409, 'Instance contains another guild.');
    tx.db().newQuery('INSERT INTO omo_installation(id,guild_id,service_key) VALUES(1,{:guild},{:key})').bind({ guild, key }).execute();
  });
};
