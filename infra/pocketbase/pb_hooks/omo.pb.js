/// <reference path="../pb_data/types.d.ts" />
routerAdd('POST', '/api/omo/v1/{operation}', (event) => {
  const { key, guild } = require(`${__hooks}/installation.js`).config($app);
  if (!/^[a-fA-F0-9]{64}$/.test(key) || !/^\d{17,20}$/.test(guild)) throw new ApiError(503, 'Storage service is not configured.');
  if (!$security.equal(event.request.header.get('X-OMO-Storage-Key'), key)) throw new UnauthorizedError('Storage access denied.');
  const body = event.requestInfo().body;
  if (body.guildId !== guild) throw new ForbiddenError('This storage instance belongs to another server.');
  event.response.header().set('Cache-Control', 'no-store');
  const operation = event.request.pathValue('operation');
  const operations = require(`${__hooks}/operations.js`);
  try {
    const result = operations.execute($app, guild, operation, body.input, body.owner);
    return event.json(200, { data: result });
  } catch (error) {
    if (error && [400, 403, 404, 409].includes(error.omoStatus)) return event.json(error.omoStatus, { error: { code: error.omoCode, message: error.message } });
    // Never forward database exception text to responses or application logs.
    return event.json(503, { error: { code: 'STORAGE_UNAVAILABLE', message: 'Storage operation failed. Check schema and service health.' } });
  }
}, $apis.bodyLimit(1048576));

// The installer can bind a fresh instance, but cannot rotate/rebind an existing one.
routerAdd('POST', '/api/omo-install/bind', (event) => {
  const body = event.requestInfo().body;
  require(`${__hooks}/installation.js`).bind($app, body.guildId, body.key);
  event.response.header().set('Cache-Control', 'no-store');
  return event.json(200, { ok: true });
}, $apis.requireSuperuserAuth(), $apis.bodyLimit(4096));
