/// <reference path="../pb_data/types.d.ts" />
// Managed storage never launches a desktop browser or creates an installer token.
// Superadmin accounts can still be created explicitly through PocketBase's CLI.
$app.onServe().bindFunc((event) => {
  event.installerFunc = null;
  return event.next();
});
