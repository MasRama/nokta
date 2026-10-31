import { TauriBridge } from './bridge/tauri.js';
import { MockBridge } from './bridge/mock.js';
import { sceneFor } from './mock/scenes.js';
import { MonitorNotch } from './monitor-notch.js';
import { setPictureUrl } from './notch/notch.js';
import { fileUrl, inTauri, onPointer, setHitRegion, systemUses24h } from './platform.js';

const app = inTauri();
const scene = sceneFor(location.search);
// Outside the app the page stands in for the desktop, so shots show the notch on a wallpaper.
if (!app) document.body.classList.add('nokta-mock');
setPictureUrl(fileUrl);

const notch = new MonitorNotch(
    app ? new TauriBridge() : new MockBridge(scene.props),
    { systemUses24h, setHit: (hit) => void setHitRegion(hit), onPointer },
    document.body,
);
window.addEventListener('resize', () => notch.setArea(window.innerWidth));
await notch.start(window.innerWidth);
if (!app && scene.open) notch.open(true);
