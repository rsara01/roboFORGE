

export function installShortcuts(bus) {
  window.addEventListener('keydown', (e) => {

    const tgt = e.target;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) {
      return;
    }
    const meta = e.metaKey || e.ctrlKey;

    if (meta && e.key.toLowerCase() === 's') {
      e.preventDefault();
      bus.saveJSON?.();
      return;
    }

    switch (e.key) {
      case 'r': case 'R': bus.setGizmoMode('rotate'); break;
      case 't': case 'T': bus.setGizmoMode('translate'); break;
      case 'g': case 'G': bus.toggleGizmo(); break;
      case ' ': e.preventDefault(); bus.togglePlay(); break;
      case 's': case 'S': bus.step(); break;
      case 'x': case 'X': bus.stop(); break;
      case 'Escape': bus.deselect(); break;
      case 'Delete': case 'Backspace':
        bus.deleteSelected();
        break;
      case 'f': case 'F': bus.frameView(); break;
      case 'ArrowLeft': bus.nudgeSelected(-1); break;
      case 'ArrowRight': bus.nudgeSelected(+1); break;
      default:
        if (/^[1-6]$/.test(e.key)) bus.selectJoint(parseInt(e.key, 10) - 1);
    }
  });
}
