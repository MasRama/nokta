import { TauriBridge } from './bridge/tauri.js';
import { MockBridge } from './bridge/mock.js';
import { sceneFor } from './mock/scenes.js';
import { MonitorNotch } from './monitor-notch.js';
import { setPictureUrl } from './notch/notch.js';
import {
    fileUrl,
    inTauri,
    onFullscreen,
    onKeyboard,
    onPointer,
    openUri,
    releaseKeyboard,
    setHitRegion,
    systemUses24h,
} from './platform.js';

const app = inTauri();
const scene = sceneFor(location.search);
// Outside the app the page stands in for the desktop, so shots show the notch on a wallpaper.
if (!app) document.body.classList.add('nokta-mock');
setPictureUrl(fileUrl);

const mock = app ? null : new MockBridge(scene.props);
const notch = new MonitorNotch(
    mock ?? new TauriBridge(),
    {
        systemUses24h,
        setHit: (hit) => void setHitRegion(hit),
        onPointer,
        onFullscreen,
        onKeyboard,
        releaseKeyboard,
        openUri,
    },
    document.body,
);
window.addEventListener('resize', () => notch.setArea(window.innerWidth));
await notch.start(window.innerWidth);
if (mock) {
    if (scene.open) notch.open(true);
    for (const [iface, signal, ...args] of scene.signals ?? []) mock.signal(iface, signal, ...args);
}
