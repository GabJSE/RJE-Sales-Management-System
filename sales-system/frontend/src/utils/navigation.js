export function requestNavigation(proceed, cancel = () => {}) {
  const event = new CustomEvent("rje-before-navigate", { cancelable: true, detail: { proceed, cancel } });
  if (window.dispatchEvent(event)) proceed();
}
