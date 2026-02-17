# Flat Price E2E Test Result

**Date:** 2026-02-17T06:46:22.638Z
**Status:** ❌ INCOMPLETE/TIMEOUT

## Console Log

```
[06:40:58.914] Connecting to browser via CDP...
[06:40:58.928] Connected
[06:40:58.941] Found 1 existing tabs
[06:40:58.941] Navigating to https://www.aliexpress.com/item/1005006995032850.html...
[06:40:59.564] [tab0:https://www.aliexpress.com/item/1005006995032850.h] error: Failed to load resource: net::ERR_SOCKS_CONNECTION_FAILED
[06:40:59.801] [tab0:https://www.aliexpress.com/item/1005006995032850.h] error: Failed to load resource: net::ERR_SOCKS_CONNECTION_FAILED
[06:41:06.862] [tab0:https://www.aliexpress.com/item/1005006995032850.h] error: Failed to load resource: net::ERR_SOCKS_CONNECTION_FAILED
[06:41:07.346] [tab0:https://www.aliexpress.com/item/1005006995032850.h] error: Failed to load resource: net::ERR_SOCKS_CONNECTION_FAILED
[06:41:09.869] [tab0:https://www.aliexpress.com/item/1005006995032850.h] error: Failed to load resource: net::ERR_SOCKS_CONNECTION_FAILED
[06:41:16.858] [tab0:https://www.aliexpress.com/item/1005006995032850.h] warn: A parser-blocking, cross site (i.e. different eTLD+1) script, https://assets.alicdn.com/g/??/AWSC/AWSC/awsc.js,/sd/baxia-entry/baxiaCommon.js, is invoked via document.write. The network request for this script MAY be blocked by the browser in this or a future page load due to poor network connectivity. If blocked in this page load, it will be confirmed in a subsequent console message. See https://www.chromestatus.com/feature/5718547946799104 for more details.
[06:41:16.859] [tab0:https://www.aliexpress.com/item/1005006995032850.h] warn: A parser-blocking, cross site (i.e. different eTLD+1) script, https://assets.alicdn.com/g/??/AWSC/AWSC/awsc.js,/sd/baxia-entry/baxiaCommon.js, is invoked via document.write. The network request for this script MAY be blocked by the browser in this or a future page load due to poor network connectivity. If blocked in this page load, it will be confirmed in a subsequent console message. See https://www.chromestatus.com/feature/5718547946799104 for more details.
[06:41:17.089] AliExpress page loaded
[06:41:22.090] Finding extension service worker...
[06:41:22.091]   target: type=browser url=
[06:41:22.091]   target: type=background_page url=chrome-extension://hikiofeedjngalncoapgpmljpaoeolci/pages/offscreen/keepalive.html
[06:41:22.091]   target: type=page url=https://www.aliexpress.com/item/1005006995032850.html
[06:41:22.091]   target: type=service_worker url=https://www.aliexpress.com/new-sw.js?version=0.0.85/js
[06:41:22.091]   target: type=service_worker url=https://www.googletagmanager.com/static/service_worker/6240/sw.js?origin=https%3A%2F%2Fwww.aliexpres
[06:41:22.091]   target: type=service_worker url=chrome-extension://hikiofeedjngalncoapgpmljpaoeolci/background/service-worker.js
[06:41:22.091]   target: type=other url=https://gum.criteo.com/syncframe?topUrl=www.aliexpress.com&origin=onetag#{%22bundle%22:{%22identifie
[06:41:22.091]   target: type=other url=https://g.alicdn.com/ae-fe/store-proxy-html/0.0.1/store-proxy2.html?iframe_delete=true
[06:41:22.091]   target: type=other url=https://www.googletagmanager.com/static/service_worker/6240/sw_iframe.html?origin=https%3A%2F%2Fwww.
[06:41:22.091] Found SW: chrome-extension://hikiofeedjngalncoapgpmljpaoeolci/background/service-worker.js
[06:41:22.094] Calling handleStartAliBulkListing directly...
[06:41:22.142] Trigger result: {"success":true,"message":"Started AliExpress bulk listing 1 items"}
[06:41:22.142] Monitoring... (15 min timeout)
[06:41:22.148] New tab opened: :
[06:41:23.521] [tab0:https://www.aliexpress.com/item/1005006995032850.h] PAGE_ERROR: Object
[06:41:26.576] [new] warn: A parser-blocking, cross site (i.e. different eTLD+1) script, https://assets.alicdn.com/g/??/AWSC/AWSC/awsc.js,/sd/baxia-entry/baxiaCommon.js, is invoked via document.write. The network request for this script MAY be blocked by the browser in this or a future page load due to poor network connectivity. If blocked in this page load, it will be confirmed in a subsequent console message. See https://www.chromestatus.com/feature/5718547946799104 for more details.
[06:41:26.576] [new] warn: A parser-blocking, cross site (i.e. different eTLD+1) script, https://assets.alicdn.com/g/??/AWSC/AWSC/awsc.js,/sd/baxia-entry/baxiaCommon.js, is invoked via document.write. The network request for this script MAY be blocked by the browser in this or a future page load due to poor network connectivity. If blocked in this page load, it will be confirmed in a subsequent console message. See https://www.chromestatus.com/feature/5718547946799104 for more details.
[06:41:28.534] [tab0:https://www.aliexpress.com/item/1005006995032850.h] PAGE_ERROR: Object
[06:41:37.145] [15s] Tabs: https://www.aliexpress.com/item/1005006995032850.html | https://www.aliexpress.com/item/1005006995032850.html
[06:41:38.538] [tab0:https://www.aliexpress.com/item/1005006995032850.h] PAGE_ERROR: Object
[06:41:38.539] [tab0:https://www.aliexpress.com/item/1005006995032850.h] PAGE_ERROR: Object
[06:41:38.556] [tab0:https://www.aliexpress.com/item/1005006995032850.h] error: Failed to load resource: net::ERR_SOCKS_CONNECTION_FAILED
[06:41:43.544] [tab0:https://www.aliexpress.com/item/1005006995032850.h] error: Failed to load resource: net::ERR_SOCKS_CONNECTION_FAILED
[06:41:45.581] [new] PAGE_ERROR: Object
[06:41:50.561] [new] PAGE_ERROR: Object
[06:41:52.151] [30s] Tabs: https://www.aliexpress.com/item/1005006995032850.html | https://www.aliexpress.com/item/1005006995032850.html
[06:41:59.972] [tab0:https://www.aliexpress.com/item/1005006995032850.h] error: Failed to load resource: net::ERR_SOCKS_CONNECTION_FAILED
[06:42:00.563] [new] PAGE_ERROR: Object
[06:42:00.563] [new] PAGE_ERROR: Object
[06:42:07.158] [45s] Tabs: https://www.aliexpress.com/item/1005006995032850.html | https://www.aliexpress.com/item/1005006995032850.html
[06:42:20.364] [tab0:https://www.aliexpress.com/item/1005006995032850.h] error: Failed to load resource: net::ERR_SOCKS_CONNECTION_FAILED
[06:42:22.163] [60s] Tabs: https://www.aliexpress.com/item/1005006995032850.html | https://www.aliexpress.com/item/1005006995032850.html
[06:42:22.168] Results written
[06:42:27.604] [new] warn: Mixed Content: The page at 'https://www.aliexpress.com/item/1005006995032850.html' was loaded over HTTPS, but requested an insecure element 'http://ae-pic-a1.aliexpress-media.com/kf/A8f9637cae619423eb11eb9cc30538ce2G.jpg_220x220.jpg_.avif'. This request was automatically upgraded to HTTPS, For more information see https://blog.chromium.org/2019/10/no-more-mixed-messages-about-https.html
[06:42:27.604] [new] warn: Mixed Content: The page at 'https://www.aliexpress.com/item/1005006995032850.html' was loaded over HTTPS, but requested an insecure element 'http://ae-pic-a1.aliexpress-media.com/kf/A4f2e1c9e0b3641178ee3ba737ac83f45D.jpg_220x220.jpg_.avif'. This request was automatically upgraded to HTTPS, For more information see https://blog.chromium.org/2019/10/no-more-mixed-messages-about-https.html
[06:42:27.605] [new] warn: Mixed Content: The page at 'https://www.aliexpress.com/item/1005006995032850.html' was loaded over HTTPS, but requested an insecure element 'http://ae-pic-a1.aliexpress-media.com/kf/A7ad0816b01ab45f1834fabfe58624475j.jpg_220x220.jpg_.avif'. This request was automatically upgraded to HTTPS, For more information see https://blog.chromium.org/2019/10/no-more-mixed-messages-about-https.html
[06:42:27.606] [new] warn: Mixed Content: The page at 'https://www.aliexpress.com/item/1005006995032850.html' was loaded over HTTPS, but requested an insecure element 'http://ae-pic-a1.aliexpress-media.com/kf/A7a74e6ea1567410aaa2f9c91763624c5A.jpg_220x220.jpg_.avif'. This request was automatically upgraded to HTTPS, For more information see https://blog.chromium.org/2019/10/no-more-mixed-messages-about-https.html
[06:42:27.606] [new] warn: Mixed Content: The page at 'https://www.aliexpress.com/item/1005006995032850.html' was loaded over HTTPS, but requested an insecure element 'http://ae-pic-a1.aliexpress-media.com/kf/A386b54c87559416e951dc21d2ff18a92T.jpg_220x220.jpg_.avif'. This request was automatically upgraded to HTTPS, For more information see https://blog.chromium.org/2019/10/no-more-mixed-messages-about-https.html
[06:42:27.606] [new] warn: Mixed Content: The page at 'https://www.aliexpress.com/item/1005006995032850.html' was loaded over HTTPS, but requested an insecure element 'http://ae-pic-a1.aliexpress-media.com/kf/A71504c0b19a04a84975d384d27c1c52an.jpg_220x220.jpg_.avif'. This request was automatically upgraded to HTTPS, For more information see https://blog.chromium.org/2019/10/no-more-mixed-messages-about-https.html
[06:42:31.443] New tab opened: :
[06:42:37.171] [75s] Tabs: https://www.aliexpress.com/item/1005006995032850.html | https://www.ebay.com.au/sl/prelist/suggest
[06:42:43.156] [new] warn: The PerformanceObserver does not support buffered flag with the entryTypes argument.
[06:42:52.177] [90s] Tabs: https://www.aliexpress.com/item/1005006995032850.html | https://www.ebay.com.au/sl/prelist/suggest?title=Nylon+LED+Night+Safety+Flashing+Glow+In+The+Dark+Do
[06:42:54.789] [new] warn: The PerformanceObserver does not support buffered flag with the entryTypes argument.
[06:43:01.478] [new] warn: The PerformanceObserver does not support buffered flag with the entryTypes argument.
[06:43:07.510] [105s] Tabs: https://www.aliexpress.com/item/1005006995032850.html | https://www.ebay.com.au/lstng?draftId=5055231585021&mode=AddItem
[06:43:22.516] [120s] Tabs: https://www.aliexpress.com/item/1005006995032850.html | https://www.ebay.com.au/lstng?draftId=5055231585021&mode=AddItem
[06:43:22.520] Results written
[06:43:29.598] [new] error: Executing inline script violates the following Content Security Policy directive 'script-src 'self' 'wasm-unsafe-eval' 'inline-speculation-rules' http://localhost:* http://127.0.0.1:* chrome-extension://247d9ed0-0c9e-4613-a63d-bb0dcd90dbb9/'. Either the 'unsafe-inline' keyword, a hash ('sha256-a2iPXnMuDWsINGsKHVHcL9oXQjw/CtzSzwwk06CbMG4='), or a nonce ('nonce-...') is required to enable inline execution. The action has been blocked.
[06:43:37.521] [135s] Tabs: https://www.aliexpress.com/item/1005006995032850.html | https://www.ebay.com.au/lstng?draftId=5055231585021&mode=AddItem
[06:43:52.527] [150s] Tabs: https://www.aliexpress.com/item/1005006995032850.html | https://www.ebay.com.au/lstng?draftId=5055231585021&mode=AddItem
[06:44:07.531] [165s] Tabs: https://www.aliexpress.com/item/1005006995032850.html | https://www.ebay.com.au/lstng?draftId=5055231585021&mode=AddItem
[06:44:22.538] [180s] Tabs: https://www.aliexpress.com/item/1005006995032850.html | https://www.ebay.com.au/lstng?draftId=5055231585021&mode=AddItem
[06:44:22.543] Results written
[06:44:37.545] [195s] Tabs: https://www.aliexpress.com/item/1005006995032850.html | https://www.ebay.com.au/lstng?draftId=5055231585021&mode=AddItem
[06:44:52.551] [210s] Tabs: https://www.aliexpress.com/item/1005006995032850.html | https://www.ebay.com.au/lstng?draftId=5055231585021&mode=AddItem
[06:45:07.561] [225s] Tabs: https://www.aliexpress.com/item/1005006995032850.html | https://www.ebay.com.au/lstng?draftId=5055231585021&mode=AddItem
[06:45:22.611] [240s] Tabs: https://www.aliexpress.com/item/1005006995032850.html | https://www.ebay.com.au/lstng?draftId=5055231585021&mode=AddItem
[06:45:22.615] Results written
[06:45:25.064] [new] warn: The PerformanceObserver does not support buffered flag with the entryTypes argument.
[06:45:32.574] [new] info: Slow network is detected. See https://www.chromestatus.com/feature/5636954674692096 for more details. Fallback font will be used while loading: https://ir.ebaystatic.com/cr/v/c1/skin/v2.5.5/fonts/vq-icon-font.woff
[06:45:37.616] [255s] Tabs: https://www.aliexpress.com/item/1005006995032850.html | https://www.ebay.com.au/lstng?draftId=5055231585021&mode=AddItem
[06:45:47.333] [new] error: Invalid 'X-Frame-Options' header encountered when loading 'https://www.ebay.com.au/': 'ALLOW-FROM https://bulkedit.ebay.com.au' is not a recognized directive. The header will be ignored.
[06:45:49.602] [new] error: Running the JavaScript URL violates the following Content Security Policy directive 'script-src 'self' 'wasm-unsafe-eval' 'inline-speculation-rules' http://localhost:* http://127.0.0.1:* chrome-extension://247d9ed0-0c9e-4613-a63d-bb0dcd90dbb9/'. Either the 'unsafe-inline' keyword, a hash ('sha256-...'), or a nonce ('nonce-...') is required to enable inline execution. Note that hashes do not apply to event handlers, style attributes and javascript: navigations unless the 'unsafe-hashes' keyword is present. The action has been blocked.
[06:45:49.604] [new] error: Running the JavaScript URL violates the following Content Security Policy directive 'script-src 'self' 'wasm-unsafe-eval' 'inline-speculation-rules' http://localhost:* http://127.0.0.1:* chrome-extension://247d9ed0-0c9e-4613-a63d-bb0dcd90dbb9/'. Either the 'unsafe-inline' keyword, a hash ('sha256-...'), or a nonce ('nonce-...') is required to enable inline execution. Note that hashes do not apply to event handlers, style attributes and javascript: navigations unless the 'unsafe-hashes' keyword is present. The action has been blocked.
[06:45:50.580] [new] error: Running the JavaScript URL violates the following Content Security Policy directive 'script-src 'self' 'wasm-unsafe-eval' 'inline-speculation-rules' http://localhost:* http://127.0.0.1:* chrome-extension://247d9ed0-0c9e-4613-a63d-bb0dcd90dbb9/'. Either the 'unsafe-inline' keyword, a hash ('sha256-...'), or a nonce ('nonce-...') is required to enable inline execution. Note that hashes do not apply to event handlers, style attributes and javascript: navigations unless the 'unsafe-hashes' keyword is present. The action has been blocked.
[06:45:50.586] [new] error: Running the JavaScript URL violates the following Content Security Policy directive 'script-src 'self' 'wasm-unsafe-eval' 'inline-speculation-rules' http://localhost:* http://127.0.0.1:* chrome-extension://247d9ed0-0c9e-4613-a63d-bb0dcd90dbb9/'. Either the 'unsafe-inline' keyword, a hash ('sha256-...'), or a nonce ('nonce-...') is required to enable inline execution. Note that hashes do not apply to event handlers, style attributes and javascript: navigations unless the 'unsafe-hashes' keyword is present. The action has been blocked.
[06:45:52.621] [270s] Tabs: https://www.aliexpress.com/item/1005006995032850.html | https://www.ebay.com.au/lstng?draftId=5055231585021&mode=AddItem
[06:45:55.564] [new] error: Running the JavaScript URL violates the following Content Security Policy directive 'script-src 'self' 'wasm-unsafe-eval' 'inline-speculation-rules' http://localhost:* http://127.0.0.1:* chrome-extension://247d9ed0-0c9e-4613-a63d-bb0dcd90dbb9/'. Either the 'unsafe-inline' keyword, a hash ('sha256-...'), or a nonce ('nonce-...') is required to enable inline execution. Note that hashes do not apply to event handlers, style attributes and javascript: navigations unless the 'unsafe-hashes' keyword is present. The action has been blocked.
[06:45:55.566] [new] error: Running the JavaScript URL violates the following Content Security Policy directive 'script-src 'self' 'wasm-unsafe-eval' 'inline-speculation-rules' http://localhost:* http://127.0.0.1:* chrome-extension://247d9ed0-0c9e-4613-a63d-bb0dcd90dbb9/'. Either the 'unsafe-inline' keyword, a hash ('sha256-...'), or a nonce ('nonce-...') is required to enable inline execution. Note that hashes do not apply to event handlers, style attributes and javascript: navigations unless the 'unsafe-hashes' keyword is present. The action has been blocked.
[06:46:03.570] [new] error: Running the JavaScript URL violates the following Content Security Policy directive 'script-src 'self' 'wasm-unsafe-eval' 'inline-speculation-rules' http://localhost:* http://127.0.0.1:* chrome-extension://247d9ed0-0c9e-4613-a63d-bb0dcd90dbb9/'. Either the 'unsafe-inline' keyword, a hash ('sha256-...'), or a nonce ('nonce-...') is required to enable inline execution. Note that hashes do not apply to event handlers, style attributes and javascript: navigations unless the 'unsafe-hashes' keyword is present. The action has been blocked.
[06:46:03.573] [new] error: Running the JavaScript URL violates the following Content Security Policy directive 'script-src 'self' 'wasm-unsafe-eval' 'inline-speculation-rules' http://localhost:* http://127.0.0.1:* chrome-extension://247d9ed0-0c9e-4613-a63d-bb0dcd90dbb9/'. Either the 'unsafe-inline' keyword, a hash ('sha256-...'), or a nonce ('nonce-...') is required to enable inline execution. Note that hashes do not apply to event handlers, style attributes and javascript: navigations unless the 'unsafe-hashes' keyword is present. The action has been blocked.
[06:46:07.627] [285s] Tabs: https://www.aliexpress.com/item/1005006995032850.html | https://www.ebay.com.au/lstng?draftId=5055231585021&mode=AddItem
[06:46:10.566] [new] error: Running the JavaScript URL violates the following Content Security Policy directive 'script-src 'self' 'wasm-unsafe-eval' 'inline-speculation-rules' http://localhost:* http://127.0.0.1:* chrome-extension://247d9ed0-0c9e-4613-a63d-bb0dcd90dbb9/'. Either the 'unsafe-inline' keyword, a hash ('sha256-...'), or a nonce ('nonce-...') is required to enable inline execution. Note that hashes do not apply to event handlers, style attributes and javascript: navigations unless the 'unsafe-hashes' keyword is present. The action has been blocked.
[06:46:10.568] [new] error: Running the JavaScript URL violates the following Content Security Policy directive 'script-src 'self' 'wasm-unsafe-eval' 'inline-speculation-rules' http://localhost:* http://127.0.0.1:* chrome-extension://247d9ed0-0c9e-4613-a63d-bb0dcd90dbb9/'. Either the 'unsafe-inline' keyword, a hash ('sha256-...'), or a nonce ('nonce-...') is required to enable inline execution. Note that hashes do not apply to event handlers, style attributes and javascript: navigations unless the 'unsafe-hashes' keyword is present. The action has been blocked.
[06:46:15.720] [new] error: Running the JavaScript URL violates the following Content Security Policy directive 'script-src 'self' 'wasm-unsafe-eval' 'inline-speculation-rules' http://localhost:* http://127.0.0.1:* chrome-extension://247d9ed0-0c9e-4613-a63d-bb0dcd90dbb9/'. Either the 'unsafe-inline' keyword, a hash ('sha256-...'), or a nonce ('nonce-...') is required to enable inline execution. Note that hashes do not apply to event handlers, style attributes and javascript: navigations unless the 'unsafe-hashes' keyword is present. The action has been blocked.
[06:46:15.723] [new] error: Running the JavaScript URL violates the following Content Security Policy directive 'script-src 'self' 'wasm-unsafe-eval' 'inline-speculation-rules' http://localhost:* http://127.0.0.1:* chrome-extension://247d9ed0-0c9e-4613-a63d-bb0dcd90dbb9/'. Either the 'unsafe-inline' keyword, a hash ('sha256-...'), or a nonce ('nonce-...') is required to enable inline execution. Note that hashes do not apply to event handlers, style attributes and javascript: navigations unless the 'unsafe-hashes' keyword is present. The action has been blocked.
[06:46:22.634] [300s] Tabs: https://www.aliexpress.com/item/1005006995032850.html | https://www.ebay.com.au/lstng?draftId=5055231585021&mode=AddItem
```
