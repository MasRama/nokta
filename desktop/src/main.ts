import { IdleNotch } from './notch/idle.js';
import { inTauri, setHitRegion, systemUses24h } from './platform.js';

// The default config's closed notch, until the settings arrive from the core.
const notch = new IdleNotch(
    { width: 180, height: 32, radius: 14, ear: 8, background: '#000000', foreground: '#ffffff' },
    systemUses24h,
);
document.body.append(notch.element);
// Outside the app the page stands in for the desktop, so shots show the notch on a wallpaper.
if (!inTauri()) document.body.classList.add('nokta-mock');
notch.start();

const report = () => void setHitRegion(notch.rect());
report();
window.addEventListener('resize', report);
