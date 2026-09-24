// Phone mode: a touch screen the size of a phone gets the compact landscape UI (the body.mobile rules at the end of
// style.css), touch-friendly placement (input.js) and starts one render quality level down (quality.js). Tablets and
// desktops keep the full UI. ?mobile forces phone mode on any device and ?mobile=0 turns it off (for testing).
const param = new URLSearchParams(location.search).get('mobile');
export const MOBILE = param !== null
  ? param !== '0'
  : matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) <= 540;

if (MOBILE) document.body.classList.add('mobile');
