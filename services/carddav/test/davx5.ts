// The requests DAVx5 makes, as it makes them: the property lists from davx5-ose (main e0c524f = v4.5.22-rc.2-ose) and
// the XML as dav4jvm 5.0.0 writes it (kXML: default namespace DAV:, prefixes CAL and CARD; a namespace it has no
// prefix for gets n0, n1… on the element).
//   discovery  core/…/servicedetection/DavResourceFinder.kt, ServiceRefresher.kt, HomeSetRefresher.kt
//   sync       core/…/resource/remote/BaseWebDavCollection.kt (queryCapabilities, querySyncState),
//              CardDavCollection.kt (PROPFIND Depth 1: resourcetype, getetag), dav4jvm ktor/DavAddressBook.kt (multiget)
//   upload     If-None-Match: * on a new card, If-Match: "<etag>" on an edit and on DELETE; text/vcard;charset=utf-8

const HEAD = `<?xml version='1.0' encoding='UTF-8' ?>`;
const PF = `<propfind xmlns="DAV:" xmlns:CAL="urn:ietf:params:xml:ns:caldav" xmlns:CARD="urn:ietf:params:xml:ns:carddav">`;
const propfind = (props: string) => `${HEAD}${PF}<prop>${props}</prop></propfind>`;

export const DAVX5 = {
  /** Step 1, Depth 0 on the address the person typed. */
  findPrincipal: propfind(`<resourcetype /><displayname /><current-user-principal /><CARD:addressbook-home-set /><CARD:addressbook-description />`),
  /** Step 2, Depth 0 on /.well-known/carddav when step 1 found no principal. */
  wellKnown: propfind(`<current-user-principal />`),
  /** Step 3, Depth 0 on the principal. */
  principal: propfind(`<displayname /><group-membership /><resourcetype /><CARD:addressbook-home-set />`),
  /** Step 4, Depth 1 on the home set. */
  homeSet: propfind(`<current-user-privilege-set /><displayname /><owner /><resourcetype /><n0:transports xmlns:n0="https://bitfire.at/webdav-push" /><n1:topic xmlns:n1="https://bitfire.at/webdav-push" /><CARD:addressbook-description />`),
  /** Sync: Depth 0 on the address book. */
  capabilities: propfind(`<supported-report-set /><sync-token /><n0:getctag xmlns:n0="http://calendarserver.org/ns/" /><CAL:max-resource-size /><CARD:max-resource-size /><CARD:supported-address-data />`),
  /** Sync: Depth 0 after uploading. */
  syncState: propfind(`<n0:getctag xmlns:n0="http://calendarserver.org/ns/" /><sync-token />`),
  /** Sync without sync-collection: Depth 1 on the address book. */
  list: propfind(`<resourcetype /><getetag />`),
  /** Download, in batches of 10, Depth 0. */
  multiget: (hrefs: string[]) => `${HEAD}<CARD:addressbook-multiget xmlns="DAV:" xmlns:CARD="urn:ietf:params:xml:ns:carddav"><prop><getcontenttype /><getetag /><CARD:address-data content-type="text/vcard" /></prop>${hrefs.map((h) => `<href>${h}</href>`).join("")}</CARD:addressbook-multiget>`,
};
