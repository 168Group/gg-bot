/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  app.db().newQuery('CREATE TABLE omo_installation(id INTEGER PRIMARY KEY CHECK(id=1),guild_id TEXT NOT NULL,service_key TEXT NOT NULL)').execute();
}, () => { throw new Error('Restore a verified backup to remove instance binding.'); });
