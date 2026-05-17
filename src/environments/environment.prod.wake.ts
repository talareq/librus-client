/**
 * Host backendu wake/notify (HTTPS, ten sam co Caddy / VPS). Bez końcowego slasha.
 * Przykład: https://librus-wake.twoja-domena.nip.io
 *
 * Gdy puste — w releasie wyłączony zdalny push (FCM wake i „nowa wersja” nie zadziałają w JS).
 * Uzupełnij przed budową APK z FCM; commit możliwy (to tylko publiczny URL).
 */
export const prodWakePublicBaseUrl = 'https://92-5-156-223.nip.io';
