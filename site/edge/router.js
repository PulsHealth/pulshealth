// CloudFront Functions viewer-request handler. The build inserts only known
// export routes and legacy targets. Unknown URLs keep the origin's real 404.
// CloudFront calls this entry point.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function handler(event) {
  var request = event.request;
  if (request.method !== 'GET' && request.method !== 'HEAD') return request;
  var redirects = /* REDIRECTS */ {};
  var routes = /* ROUTES */ [];
  var uri = request.uri;
  var normalized = uri.replace(/\/index\.html$/, '/');
  if (normalized.slice(-1) !== '/') normalized += '/';
  var key = normalized.replace('/knowledge-base/types/HKQuantityTypeIdentifier', '/q/').replace('/knowledge-base/types/HKCategoryTypeIdentifier', '/c/');
  var target = redirects[normalized];
  if (!target && routes.indexOf(key) !== -1 && uri !== normalized) target = normalized;
  if (!target && request.headers.host.value === 'www.pulshealth.com') target = uri;
  if (!target) return request;
  if (target.charAt(0) === '/') target = 'https://pulshealth.com' + target;
  var query = [];
  Object.keys(request.querystring || {}).forEach(function (name) {
    var field = request.querystring[name];
    var values = field.multiValue || [field];
    values.forEach(function (entry) { query.push(name + '=' + entry.value); });
  });
  if (query.length) {
    var parts = target.split('#');
    target = parts[0] + (parts[0].indexOf('?') === -1 ? '?' : '&') + query.join('&') + (parts.length > 1 ? '#' + parts.slice(1).join('#') : '');
  }
  return { statusCode: 301, statusDescription: 'Moved Permanently', headers: { location: { value: target } } };
}
