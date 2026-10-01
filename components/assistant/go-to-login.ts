/**
 * 401 от сервера — сессия умерла (выход на другом устройстве, сброс PIN). Полная загрузка /enter, а не переход
 * роутера: клиентское состояние этой сессии больше не годится, а вход сам поставит новую cookie.
 * Абсолютный адрес, а не строка «/enter»: правило @next/next/no-location-assign-relative-destination запрещает относительный.
 */
export const goToLogin = () => window.location.assign(new URL("/enter", window.location.href).href);
