import { Injectable } from '@angular/core';
import { Grade, GradesBySubject, Message, Note, Announcement, CalendarEvent } from '../models/librus-data.models';
import { enrichCalendarEvent } from '../utils/calendar-parse';
import { deriveGradeDateISO } from '../utils/grade-semester';

@Injectable({
  providedIn: 'root'
})
export class LibrusScraperService {

  constructor() {}

  // Scraping ocen z szczegółami
  getGradesScript(): string {
    return `
      (function() {
        try {
          function clean(text) {
            return (text || '').replace(/\\s+/g, ' ').trim();
          }

          function trunc(s, max) {
            var t = clean(s);
            if (!max) max = 400;
            return t.length <= max ? t : t.slice(0, max);
          }

          var wyniki = [];
          var wiersze = document.querySelectorAll('tr.line0, tr.line1');
          
          wiersze.forEach(function(wiersz, rowIndex) {
            try {
              /** Pomijamy wiersze ze zagnieżdżonej tabeli (szczegóły w komórce colspan). */
              if (wiersz.closest('td')) {
                return;
              }

              var kolumny = wiersz.cells;
              if (kolumny.length < 3) {
                return;
              }
              var przedmiot = '';
              var komorkiOcen = [];

              if (kolumny.length >= 4) {
                przedmiot = kolumny[1] ? clean(kolumny[1].innerText) : '';
                komorkiOcen = [kolumny[2], kolumny[3]];
              } else {
                przedmiot = kolumny[0] ? clean(kolumny[0].innerText) : '';
                komorkiOcen = [kolumny[1], kolumny[2]];
              }

              var oceny = [];

              komorkiOcen.forEach(function(komorkaOcen, komorkaIx) {
                if (!komorkaOcen) {
                  return;
                }
                var ocenyElementy = komorkaOcen.querySelectorAll('span.grade-box a, a.grade-box');
                if (!ocenyElementy.length) {
                  ocenyElementy = komorkaOcen.querySelectorAll('.grade-value a, td.oceny a');
                }
                if (!ocenyElementy.length) {
                  ocenyElementy = komorkaOcen.querySelectorAll('a');
                }

                ocenyElementy.forEach(function(ocenaBox, gradeIndex) {
                  try {
                    var link = ocenaBox.tagName && ocenaBox.tagName.toLowerCase() === 'a' ? ocenaBox : ocenaBox.querySelector('a');
                    var element = link || ocenaBox;
                    var ocenaValue = clean(element.innerText || element.textContent || '');
                    var title = element.getAttribute ? (element.getAttribute('title') || '') : '';
                    var href = link && link.getAttribute ? (link.getAttribute('href') || '') : '';

                    if (!/^[1-6][+-]?$|^[1-6],[0-9]+$|^[1-6]\\.[0-9]+$|^np$|^bz$/i.test(ocenaValue)) {
                      return;
                    }
                    
                    var opis = '';
                    var data = '';
                    var nauczyciel = '';
                    var waga = '';
                    var kategoria = '';
                    
                    var lines = title.split('\\n');
                    if (lines.length > 0) {
                      opis = trunc(lines[0], 500);
                    }
                    lines.forEach(function(line) {
                      var cleanedLine = clean(line);
                      var dmIso = cleanedLine.match(/Data(?:\\s+oceny)?\\s*[:\.]?\\s*(\\d{4}-\\d{2}-\\d{2})/i);
                      var dmPl = cleanedLine.match(/Data(?:\\s+oceny)?\\s*[:\.]?\\s*(\\d{1,2}\\.\\d{1,2}\\.\\d{4})/i);
                      if (dmIso && dmIso[1]) {
                        data = trunc(dmIso[1].trim(), 80);
                      } else if (dmPl && dmPl[1]) {
                        data = trunc(dmPl[1].trim(), 80);
                      } else if (cleanedLine.indexOf('Data:') !== -1 || /^Data\\b/i.test(cleanedLine)) {
                        data = trunc(cleanedLine.replace(/.*?Data[^:]*:\\s*/i, ''), 80);
                      } else if (cleanedLine.indexOf('Nauczyciel:') !== -1) {
                        nauczyciel = trunc(cleanedLine.replace('Nauczyciel:', ''), 120);
                      } else if (cleanedLine.indexOf('Waga:') !== -1) {
                        waga = trunc(cleanedLine.replace('Waga:', ''), 40);
                      } else if (cleanedLine.indexOf('Kategoria:') !== -1) {
                        kategoria = trunc(cleanedLine.replace('Kategoria:', ''), 80);
                      }
                    });
                    
                    if (ocenaValue && przedmiot && przedmiot.indexOf('Zachowanie') === -1) {
                      var idBasis = trunc(title, 120) + '|' + trunc(href, 160) + '|' + rowIndex + '|' + komorkaIx + '|' + gradeIndex;
                      oceny.push({
                        id: trunc(przedmiot, 80) + '|' + ocenaValue + '|' + idBasis,
                        value: ocenaValue,
                        description: opis,
                        date: data,
                        teacher: nauczyciel,
                        weight: waga,
                        category: kategoria
                      });
                    }
                  } catch (gradeError) {
                    oceny.push({
                      id: ['grade-error', rowIndex, komorkaIx, gradeIndex].join('|'),
                      value: 'ERR',
                      description: String(gradeError && gradeError.message ? gradeError.message : gradeError)
                    });
                  }
                });
              });

              if (przedmiot && oceny.length > 0) {
                wyniki.push({ przedmiot: przedmiot, oceny: oceny });
              }
            } catch (rowError) {
              wyniki.push({
                przedmiot: 'SCRAPER_ROW_ERROR',
                oceny: [{ value: 'ERR', description: String(rowError && rowError.message ? rowError.message : rowError) }]
              });
            }
          });
          
          return JSON.stringify(wyniki);
        } catch (error) {
          return JSON.stringify([{ przedmiot: 'SCRAPER_ERROR', oceny: [{ value: 'ERR', description: String(error && error.message ? error.message : error) }] }]);
        }
      })();
    `;
  }

  /**
   * Oceny: jak w starej aplikacji — tylko `span.grade-box a`.
   * Pełny JSON jest za duży dla jednego zwrotu Cordova/WKWebView → zapis w window.__LIBR_GR[].
   */
  getGradesChunkBootstrapScript(): string {
    return `
      (function() {
        try {
          function clean(text) {
            return (text || '').replace(/\\s+/g, ' ').trim();
          }

          function trunc(s, max) {
            var t = clean(s);
            if (!max) max = 400;
            return t.length <= max ? t : t.slice(0, max);
          }

          var CHUNK = 6144;

          function normalizeTooltip(html) {
            var s = String(html || '');
            s = s.replace(/<script[^>]*>[\\s\\S]*?<\\/script>/gi, '');
            s = s.replace(/<\\s*br\\s*\\/?>/gi, '\\n');
            s = s.replace(/<\\/p>/gi, '\\n');
            s = s.replace(/<\\/div>/gi, '\\n');
            s = s.replace(/<\\/li>/gi, '\\n');
            s = s.replace(/<\\/tr>/gi, '\\n');
            s = s.replace(/<[^>]+>/g, ' ');
            s = s.replace(/&nbsp;/g, ' ');
            s = s.replace(/&amp;/g, '&');
            s = s.replace(/&(lt|gt|quot);/g, ' ');
            return clean(s);
          }

          function parseTitle(titleHtml) {
            var opis = '';
            var data = '';
            var nauczyciel = '';
            var waga = '';
            var kategoria = '';
            var komentarz = '';
            var flat = normalizeTooltip(titleHtml);
            var lines = flat.split('\\n');
            if (lines.length > 0) {
              opis = trunc(lines[0].replace(/^Obszar oceniania:\\s*/i, ''), 500);
            }
            lines.forEach(function(line) {
              var cleanedLine = clean(line);
              if (!cleanedLine) return;
              var dmIso = cleanedLine.match(/Data(?:\\s+oceny)?\\s*[:\.]?\\s*(\\d{4}-\\d{2}-\\d{2})/i);
              var dmPl = cleanedLine.match(/Data(?:\\s+oceny)?\\s*[:\.]?\\s*(\\d{1,2}\\.\\d{1,2}\\.\\d{4})/i);
              if (dmIso && dmIso[1]) {
                data = trunc(dmIso[1].trim(), 80);
              } else if (dmPl && dmPl[1]) {
                data = trunc(dmPl[1].trim(), 80);
              } else if (cleanedLine.indexOf('Data:') !== -1 || /^Data\\b/i.test(cleanedLine)) {
                data = trunc(cleanedLine.replace(/.*?Data[^:]*:\\s*/i, ''), 80);
              }
              if (cleanedLine.indexOf('Nauczyciel:') !== -1) {
                nauczyciel = trunc(cleanedLine.replace(/.*?Nauczyciel:\\s*/i, ''), 120);
              }
              if (cleanedLine.indexOf('Waga:') !== -1) {
                waga = trunc(cleanedLine.replace(/.*?Waga:\\s*/i, ''), 40);
              }
              if (cleanedLine.indexOf('Kategoria:') !== -1) {
                kategoria = trunc(cleanedLine.replace(/.*?Kategoria:\\s*/i, ''), 80);
              }
              if (cleanedLine.indexOf('Komentarz:') !== -1) {
                komentarz = trunc(cleanedLine.replace(/.*?Komentarz:\\s*/i, ''), 400);
              }
            });
            if (komentarz) {
              opis = trunc((opis ? opis + ' — ' : '') + komentarz, 700);
            }
            return { opis: opis, data: data, nauczyciel: nauczyciel, waga: waga, kategoria: kategoria };
          }

          var wyniki = [];
          var wiersze = document.querySelectorAll('tr.line0, tr.line1');

          wiersze.forEach(function(wiersz, rowIndex) {
            if (wiersz.closest('td')) {
              return;
            }

            var kolumny = wiersz.cells;
            if (kolumny.length < 3) {
              return;
            }

            var przedmiot = '';
            var komorkiOcen = [];

            if (kolumny.length >= 4) {
              przedmiot = kolumny[1] ? clean(kolumny[1].innerText) : '';
              komorkiOcen = [kolumny[2], kolumny[3]];
            } else {
              przedmiot = kolumny[0] ? clean(kolumny[0].innerText) : '';
              komorkiOcen = [kolumny[1], kolumny[2]];
            }

            var oceny = [];

            komorkiOcen.forEach(function(kkom, komorkaIx) {
              if (!kkom) {
                return;
              }
              var ocenyElementy = kkom.querySelectorAll('span.grade-box a');

              ocenyElementy.forEach(function(a, gradeIndex) {
                var ocenaValue = clean(a.innerText || a.textContent || '');
                if (!/^[1-6][+-]?$|^[1-6],[0-9]+$|^[1-6]\\.[0-9]+$|^np$|^bz$/i.test(ocenaValue)) {
                  return;
                }
                if (!przedmiot || przedmiot.indexOf('Zachowanie') !== -1) {
                  return;
                }
                var title = (a.getAttribute && a.getAttribute('title')) || '';
                var href = (a.getAttribute && a.getAttribute('href')) || '';
                var pt = parseTitle(title);
                var idBasis =
                  trunc(title, 120) + '|' + trunc(href, 160) + '|' + rowIndex + '|' + komorkaIx + '|' + gradeIndex;
                oceny.push({
                  id: trunc(przedmiot, 80) + '|' + ocenaValue + '|' + idBasis,
                  value: ocenaValue,
                  description: pt.opis,
                  date: pt.data,
                  teacher: pt.nauczyciel,
                  weight: pt.waga,
                  category: pt.kategoria
                });
              });
            });

            if (przedmiot && oceny.length > 0) {
              wyniki.push({ przedmiot: przedmiot, oceny: oceny });
            }
          });

          var json = JSON.stringify(wyniki);
          window.__LIBR_GR = [];
          for (var i = 0; i < json.length; i += CHUNK) {
            window.__LIBR_GR.push(json.slice(i, i + CHUNK));
          }
          return JSON.stringify({
            ok: true,
            parts: window.__LIBR_GR.length,
            len: json.length
          });
        } catch (error) {
          return JSON.stringify({
            ok: false,
            error: String(error && error.message ? error.message : error)
          });
        }
      })();
    `;
  }

  // Scraping wiadomości (stary HTML + lista MUI w wiadomosci.librus.pl)
  getMessagesScript(): string {
    return `
      (function() {
        try {
          function clean(text) {
            return (text || '').replace(/\\s+/g, ' ').trim();
          }

          /** Fallback: jedna strona API (bez pętli sync XHR) — pętle z bridge Cordova mogą zamrozić WebView/most. */
          function scrapeInboxApiRest() {
            var API_ROOT = 'https://wiadomosci.librus.pl/api/inbox/messages';
            function httpGetSync(absUrl) {
              var xhr = new XMLHttpRequest();
              try {
                xhr.open('GET', absUrl, false);
                xhr.setRequestHeader('Accept', 'application/json');
                xhr.send(null);
                if (xhr.status >= 200 && xhr.status < 300 && xhr.responseText) {
                  return xhr.responseText;
                }
              } catch (err) {}
              return '';
            }
            function fmtPl(fromIso) {
              if (!fromIso) return '';
              var d = new Date(fromIso);
              if (isNaN(d.getTime())) return String(fromIso);
              try {
                return d.toLocaleString('pl-PL', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                });
              } catch (e4) {
                return fromIso.slice(0, 16).replace('T', ' ');
              }
            }

            var all = [];
            var raw = httpGetSync(API_ROOT + '?page=1&limit=100');
            if (!raw) return all;
            var json;
            try {
              json = JSON.parse(raw);
            } catch (e5) {
              return all;
            }
            if (!json || !json.data || !json.data.length) return all;

            json.data.forEach(function(m) {
              if (!m || m.messageId == null) return;
              var iso = m.sendDate || '';
              /** Bez pola body (male JSON przez most Cordova). */
              all.push({
                id: String(m.messageId),
                sender: clean(m.senderName || ''),
                subject: clean(m.topic || ''),
                date: fmtPl(iso),
                sendDateIso: iso,
                isRead: !!(m.readDate),
                hasAttachment: !!m.isAnyFileAttached,
                body: ''
              });
            });

            return all;
          }

          /** Tylko bezpośrednie komórki <td> — unika zagnieżdżonych tabel */
          function directTds(tr) {
            var out = [];
            var ch = tr.children;
            for (var i = 0; i < ch.length; i++) {
              if (ch[i].tagName === 'TD') out.push(ch[i]);
            }
            return out;
          }

          /** Inbox MUI: checkbox | Nadawca | Temat | załącznik | Data */
          function scrapeMuiInboxTable(doc) {
            var out = [];
            var inboxTable = null;
            doc.querySelectorAll('table.MuiTable-root').forEach(function(tbl) {
              if (tbl.querySelector('tbody td input[type="checkbox"]')) {
                inboxTable = tbl;
              }
            });
            if (!inboxTable) inboxTable = doc.querySelector('table.MuiTable-root');

            var tbl = inboxTable;
            if (!tbl || !tbl.querySelector('tbody')) return out;
            var rows = tbl.querySelectorAll('tbody tr');
            rows.forEach(function(row, ix) {
              if (row.classList.contains('MuiTableRow-head')) return;
              var cells = directTds(row);
              if (cells.length !== 5) {
                cells = Array.prototype.slice.call(row.querySelectorAll('td'));
              }
              if (cells.length < 4 || cells.length > 8) return;

              var senderCell;
              var subjectCell;
              var attachCell = null;
              var dateCell;
              if (cells.length >= 5) {
                senderCell = cells[1];
                subjectCell = cells[2];
                attachCell = cells[3];
                dateCell = cells[cells.length - 1];
              } else {
                senderCell = cells[1];
                subjectCell = cells[2];
                dateCell = cells[cells.length - 1];
              }

              var sender = clean(senderCell ? (senderCell.getAttribute('title') || senderCell.innerText || '') : '');
              var subject = clean(subjectCell ? (subjectCell.getAttribute('title') || subjectCell.innerText || '') : '');
              var date = clean(dateCell ? dateCell.innerText || '' : '');
              var attachRoot = attachCell || row;
              var hasAttachment = !!attachRoot.querySelector('[data-testid="AttachFileIcon"], svg[data-testid="AttachFileIcon"]');

              var dataId =
                row.getAttribute('data-message-id') ||
                row.getAttribute('data-id');
              var link = row.querySelector('a[href*="/"], a[href*="message"], a[href*="wiadom"]');
              var id =
                dataId ||
                (link ? link.href : '') ||
                ['msg', sender, subject, date, ix].join('|');

              if (sender && subject && date) {
                out.push({
                  id: String(id),
                  sender: sender,
                  subject: subject,
                  date: date,
                  isRead: true,
                  hasAttachment: hasAttachment
                });
              }
            });
            return out;
          }

          /** Gdy lista zniknie i widać tylko treść pojedynczej wiadomości */
          function scrapeMuiMessageDetail(doc) {
            var topicEl = doc.querySelector('p.MuiTypography-h4[class*="messageTopic"], p.MuiTypography-h4[class*="Topic"]');
            if (!topicEl) topicEl = doc.querySelector('.MuiTypography-h4[class*="Topic"]');
            if (!topicEl) return null;

            var subject = clean(topicEl.innerText || '');
            if (!subject || subject.length < 2) return null;

            var dateEl =
              doc.querySelector('p.MuiTypography-body2[class*="messageDate"]') ||
              doc.querySelector('[class*="messageDate"]');
            var date = dateEl ? clean(dateEl.innerText || '') : '';

            var bestBody = '';
            doc.querySelectorAll('div[class*="messageContainer"] p.MuiTypography-body1').forEach(function(el) {
              var cn = typeof el.className === 'string' ? el.className : '';
              if (cn.indexOf('messageInfo') !== -1) return;
              if (cn.indexOf('messageDate') !== -1) return;
              if (cn.indexOf('messageTopic') !== -1) return;
              var t = ((el.innerText || '') || '').replace(/\\u00a0/g, ' ').trim();
              if (t.length < 35) return;
              if (/^Od:\\s*"$/i.test(t)) return;
              if (t.indexOf('nauczyciel') !== -1 && t.length < 150) return;
              if (t.length > bestBody.length) bestBody = t;
            });

            if (!bestBody || bestBody.length < 40) return null;

            var id = ['msg', 'detail', subject, date].join('|');

            var senderGuess = '';
            doc.querySelectorAll('p.MuiTypography-body1').forEach(function(p) {
              var s = clean(p.innerText || '');
              if (s.indexOf('(') !== -1 && s.indexOf('nauczyciel') !== -1 && s.length < 160) senderGuess = s;
            });

            return {
              id: id,
              sender: senderGuess,
              subject: subject,
              date: date || subject.slice(0, 16),
              isRead: true,
              hasAttachment: !!doc.querySelector('[data-testid="AttachFileIcon"]'),
              body: bestBody
            };
          }

          /** Stary HTML / inne tabele z tym samym układem 5 kolumn */
          function scrapeLegacy(doc) {
            var out = [];
            doc
              .querySelectorAll('#contentMain tbody tr, table tbody tr, .message-row, [data-message-id]')
              .forEach(function(row, index) {
                if (row.closest && row.closest('thead')) return;
                if (row.classList.contains('MuiTableRow-head')) return;
                var cells = directTds(row);
                if (cells.length === 5) {
                  var senderCell = cells[1];
                  var subjectCell = cells[2];
                  var attachCell = cells[3];
                  var dateCell = cells[4];
                  var sender = clean(
                    senderCell ? (senderCell.getAttribute('title') || senderCell.innerText) : ''
                  );
                  var subject = clean(
                    subjectCell ? (subjectCell.getAttribute('title') || subjectCell.innerText) : ''
                  );
                  var date = clean(dateCell ? dateCell.innerText : '');
                  var hasAttachment =
                    !!(attachCell && clean(attachCell.innerText)) ||
                    !!row.querySelector('[data-testid="AttachFileIcon"]');
                  var isRead =
                    !row.className.includes('unread') && !row.className.includes('Unread');
                  var checkbox = row.querySelector('input[type="checkbox"]');
                  var link = row.querySelector('a[href]');
                  var id =
                    row.getAttribute('data-message-id') ||
                    row.getAttribute('data-id') ||
                    (checkbox ? checkbox.value : '') ||
                    (link ? link.href : '') ||
                    ['message', sender, subject, date, index].join('|');
                  if (sender && subject && date) {
                    out.push({
                      id: id,
                      sender: sender,
                      subject: subject,
                      date: date,
                      isRead: isRead,
                      hasAttachment: hasAttachment
                    });
                  }
                } else if (cells.length >= 3) {
                  var fallbackSender = clean(cells[0] ? cells[0].innerText : '');
                  var fallbackSubject = clean(cells[1] ? cells[1].innerText : '');
                  var fallbackDate = clean(
                    cells[cells.length - 1] ? cells[cells.length - 1].innerText : ''
                  );
                  if (
                    fallbackSubject &&
                    fallbackDate &&
                    /[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]/.test(fallbackSubject)
                  ) {
                    out.push({
                      id: ['message', fallbackSender, fallbackSubject, fallbackDate, index].join('|'),
                      sender: fallbackSender,
                      subject: fallbackSubject,
                      date: fallbackDate,
                      isRead: true,
                      hasAttachment: false
                    });
                  }
                }
              });
            return out;
          }

          var wiadomosci = scrapeMuiInboxTable(document);
          if (wiadomosci.length === 0) {
            wiadomosci = scrapeLegacy(document);
          }

          if (wiadomosci.length === 0) {
            wiadomosci = scrapeInboxApiRest();
          }

          if (wiadomosci.length === 0) {
            var one = scrapeMuiMessageDetail(document);
            if (one) wiadomosci.push(one);
          }

          return JSON.stringify(wiadomosci);
        } catch (error) {
          return JSON.stringify([
            {
              id: 'scraper-error',
              sender: 'SCRAPER',
              subject: String(error && error.message ? error.message : error),
              date: '',
              isRead: true
            }
          ]);
        }
      })();
    `;
  }

  /**
   * Pobiera jedną wiadomość po ID (XHR w WebView pod wiadomosci.librus.pl).
   * Jeśli brak endpointu GET /messages/:id, skanuje strony listy (?page=)
   */
  getMessageDetailApiScript(messageId: string): string {
    const digits = String(messageId ?? '').replace(/\D/g, '');
    if (!digits) {
      return `(function(){ return JSON.stringify(null); })();`;
    }
    const mid = digits;
    return `
      (function() {
        try {
          var MID = '${mid}';
          var BASE = 'https://wiadomosci.librus.pl/api/inbox/messages';
          function httpGetSync(absUrl) {
            var xhr = new XMLHttpRequest();
            try {
              xhr.open('GET', absUrl, false);
              xhr.setRequestHeader('Accept', 'application/json');
              xhr.send(null);
              if (xhr.status >= 200 && xhr.status < 300 && xhr.responseText) {
                return xhr.responseText;
              }
            } catch (e1) {}
            return '';
          }
          function decodeB64Utf8(b64) {
            if (!b64 || typeof b64 !== 'string') return '';
            try {
              var bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
              var bytes = new Uint8Array(bin.length);
              var i = 0;
              for (; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
              if (typeof TextDecoder !== 'undefined') {
                return new TextDecoder('utf-8').decode(bytes);
              }
              return decodeURIComponent(escape(bin));
            } catch (e2) {
              return '';
            }
          }
          function parseRow(txt) {
            var j = null;
            try {
              j = JSON.parse(txt);
            } catch (px) {
              return null;
            }
            if (!j) return null;
            if (j.messageId) return j;
            if (j.data != null) {
              if (Array.isArray(j.data) && j.data.length && j.data[0].messageId) return j.data[0];
              if (!Array.isArray(j.data) && j.data.messageId) return j.data;
            }
            return null;
          }
          function fetchOne() {
            var u = BASE + '/' + MID;
            var t = httpGetSync(u);
            if (t) {
              try {
                var r = parseRow(t);
                if (r && String(r.messageId) === MID) return r;
              } catch (_) {}
            }
            var page = 1;
            while (page <= 40) {
              t = httpGetSync(BASE + '?page=' + page + '&limit=50');
              if (!t) break;
              var J = null;
              try {
                J = JSON.parse(t);
              } catch (px) {
                break;
              }
              if (!J || !J.data || !J.data.length) break;
              var k = 0;
              for (; k < J.data.length; k++) {
                var row = J.data[k];
                if (row && String(row.messageId) === MID) return row;
              }
              if (typeof J.total === 'number' && page * 50 >= J.total) break;
              if (J.data.length < 50) break;
              page++;
            }
            return null;
          }
          var row = fetchOne();
          if (!row) return JSON.stringify(null);
          var iso = row.sendDate || '';
          function fmt(fromIso) {
            if (!fromIso) return '';
            var d = new Date(fromIso);
            return isNaN(d.getTime()) ? fromIso : d.toLocaleString('pl-PL', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
          }
          return JSON.stringify({
            id: String(row.messageId),
            body: decodeB64Utf8(row.content || ''),
            subject: String(row.topic || ''),
            sender: String(row.senderName || ''),
            sendDateIso: iso,
            date: fmt(iso),
            isRead: !!(row.readDate),
            hasAttachment: !!row.isAnyFileAttached
          });
        } catch (e3) {
          return JSON.stringify(null);
        }
      })();
    `;
  }

  // Scraping uwag
  getNotesScript(): string {
    return `
      (function() {
        try {
          function clean(text) {
            return (text || '').replace(/\\s+/g, ' ').trim();
          }

          var uwagi = [];
          var rows = document.querySelectorAll('#contentMain tbody tr, table tbody tr, .MuiTableBody-root tr, .note-row, [data-note-id]');
          
          rows.forEach(function(row, index) {
            var cells = row.querySelectorAll('td');
            if (cells.length >= 5) {
              var teacher = clean(cells[1] ? (cells[1].getAttribute('title') || cells[1].innerText) : '');
              var content = clean(cells[2] ? (cells[2].getAttribute('title') || cells[2].innerText) : '');
              var date = clean(cells[4] ? cells[4].innerText : '');
              var id = row.getAttribute('data-note-id') || row.getAttribute('data-id') || ['note', date, teacher, content].join('|');
              
              if (content) {
                uwagi.push({
                  id: id,
                  teacher: teacher,
                  content: content,
                  date: date,
                  category: ''
                });
              }
            } else if (cells.length >= 3) {
              var fallbackDate = clean(cells[0] ? cells[0].innerText : '');
              var fallbackTeacher = clean(cells[1] ? cells[1].innerText : '');
              var fallbackContent = clean(cells[2] ? cells[2].innerText : '');
              var category = clean(cells[3] ? cells[3].innerText : '');
              if (fallbackContent) {
                uwagi.push({
                  id: ['note', fallbackDate, fallbackTeacher, fallbackContent, category].join('|'),
                  teacher: fallbackTeacher,
                  content: fallbackContent,
                  date: fallbackDate,
                  category: category
                });
              }
            }
          });
          
          return JSON.stringify(uwagi);
        } catch (error) {
          return JSON.stringify([{ id: 'scraper-error', teacher: 'SCRAPER', content: String(error && error.message ? error.message : error), date: '', category: '' }]);
        }
      })();
    `;
  }

  // Scraping ogłoszeń
  getAnnouncementsScript(): string {
    return `
      (function() {
        function clean(text) {
          return (text || '').replace(/\\s+/g, ' ').trim();
        }

        var ogloszenia = [];
        var items = document.querySelectorAll('.container-background, .announcement, table tbody tr');
        
        items.forEach(function(item, index) {
          var titleEl = item.querySelector('h3, .announcement-title');
          var contentEl = item.querySelector('.announcement-content, p');
          var authorEl = item.querySelector('.author, .small');
          var dateEl = item.querySelector('.date, time');
          var cells = item.querySelectorAll('td');
          
          var title = titleEl ? clean(titleEl.innerText) : (cells[1] ? clean(cells[1].innerText) : '');
          var content = contentEl ? clean(contentEl.innerText) : (cells[2] ? clean(cells[2].innerText) : '');
          var author = authorEl ? clean(authorEl.innerText) : (cells[0] ? clean(cells[0].innerText) : '');
          var date = dateEl ? clean(dateEl.innerText) : (cells[cells.length - 1] ? clean(cells[cells.length - 1].innerText) : '');
          var id = ['announcement', title, author, date].join('|');
          
          if (title) {
            ogloszenia.push({
              id: id,
              title: title,
              content: content,
              author: author,
              date: date
            });
          }
        });
        
        return JSON.stringify(ogloszenia);
      })();
    `;
  }

  // Scraping terminarza
  getCalendarScript(): string {
    return `
      (function() {
        function clean(text) {
          return (text || '').replace(/\\s+/g, ' ').trim();
        }

        function hasLetters(text) {
          return /[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,}/.test(text || '');
        }

        function isMeaningfulEvent(title, description, type) {
          var combined = [title, description, type].join(' ');
          if (!hasLetters(combined)) return false;
          if (/^\\d{1,2}$/.test(title || '') && /^\\d{0,2}$/.test(description || '') && /^\\d{0,2}$/.test(type || '')) return false;
          return true;
        }

        function extractDateFromBlob(blob) {
          if (!blob) return '';
          var m = blob.match(/\\d{4}-\\d{2}-\\d{2}/);
          if (m) return m[0];
          m = blob.match(/\\d{1,2}[.]\\d{1,2}[.]\\d{4}/);
          return m ? m[0] : '';
        }

        function padMonthPart(n) {
          return n < 10 ? '0' + n : String(n);
        }

        function detectPageMonthISO() {
          var blob = '';
          if (document.body) blob += document.body.innerText.slice(0, 12000);
          blob += ' ' + (document.title || '');
          var heads = document.querySelectorAll(
            'caption, .fc-toolbar-title, h1, h2, .navigation, .calendar-caption, .datepicker, [class*="Month"], [class*="month-title"]'
          );
          for (var hi = 0; hi < heads.length; hi++) {
            blob += ' ' + (heads[hi].innerText || '');
          }
          var lower = blob.toLowerCase();
          var y = new Date().getFullYear();
          var yMatch = blob.match(/\\b(20\\d{2})\\b/);
          if (yMatch) y = parseInt(yMatch[1], 10);

          var ordered = [
            ['października', 10],
            ['pazdziernika', 10],
            ['września', 9],
            ['wrzesnia', 9],
            ['listopada', 11],
            ['grudnia', 12],
            ['stycznia', 1],
            ['lutego', 2],
            ['marca', 3],
            ['kwietnia', 4],
            ['maja', 5],
            ['czerwca', 6],
            ['lipca', 7],
            ['sierpnia', 8],
            ['sty', 1],
            ['lut', 2],
            ['mar', 3],
            ['kwi', 4],
            ['maj', 5],
            ['cze', 6],
            ['lip', 7],
            ['sie', 8],
            ['wrz', 9],
            ['paź', 10],
            ['paz', 10],
            ['lis', 11],
            ['gru', 12]
          ];

          var pair = blob.match(
            /\\b(stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|wrzesnia|września|października|pazdziernika|listopada|grudnia)\\s+(20\\d{2})\\b/i
          );
          if (pair) {
            var lw = pair[1].toLowerCase();
            for (var pj = 0; pj < ordered.length; pj++) {
              if (ordered[pj][0] === lw) {
                return parseInt(pair[2], 10) + '-' + padMonthPart(ordered[pj][1]);
              }
            }
          }

          for (var oi = 0; oi < ordered.length; oi++) {
            if (lower.indexOf(ordered[oi][0]) !== -1) {
              return y + '-' + padMonthPart(ordered[oi][1]);
            }
          }

          var d = new Date();
          return d.getFullYear() + '-' + padMonthPart(d.getMonth() + 1);
        }

        var PAGE_MONTH_ISO = detectPageMonthISO();

        function normalizeDateHint(raw) {
          var s = clean(raw || '');
          var iso = s.match(/^(\\d{4}-\\d{2}-\\d{2})/);
          if (iso) return iso[1];
          var pl = s.match(/\\b(\\d{1,2})[.](\\d{1,2})[.](\\d{4})\\b/);
          return pl ? pl[0] : '';
        }

        function findDateNearNode(node) {
          if (node && node.closest) {
            var holder = node.closest('[data-date]');
            if (holder) {
              var dv = holder.getAttribute('data-date');
              if (dv) {
                dv = dv.trim();
                if (/^\\d{4}-\\d{2}-\\d{2}$/.test(dv)) return dv;
                var nd = normalizeDateHint(dv);
                if (nd) return nd;
              }
            }
          }
          var el = node;
          for (var depth = 0; depth < 18 && el; depth++) {
            if (el.getAttribute) {
              var attrNames = ['data-date', 'data-day', 'data-full-date', 'data-event-date', 'data-start', 'title'];
              for (var ai = 0; ai < attrNames.length; ai++) {
                var av = el.getAttribute(attrNames[ai]);
                if (av && /\\d/.test(av)) {
                  var hint = normalizeDateHint(av);
                  if (hint) return hint;
                  return clean(av);
                }
              }
            }
            var href = el.href || (el.getAttribute && el.getAttribute('href')) || '';
            if (href.indexOf('http') !== -1) {
              var dm = href.match(/(?:date|day|dzien)=(\\d{4}-\\d{2}-\\d{2})/i);
              if (dm) return dm[1];
              dm = href.match(/(\\d{4})[/-](\\d{2})[/-](\\d{2})/);
              if (dm) return dm[1] + '-' + dm[2] + '-' + dm[3];
            }
            el = el.parentElement;
          }
          var row = node.closest && node.closest('tr');
          if (row) {
            var th = row.querySelector('th');
            if (th) {
              var tt = clean(th.innerText || '');
              if (/\\d/.test(tt)) return tt;
            }
            var rcells = row.querySelectorAll('td');
            if (rcells.length > 1) {
              var c0 = clean(rcells[0].innerText || '');
              if (/\\d{4}-\\d{2}-\\d{2}/.test(c0) || /\\d{1,2}[.]\\d{1,2}[.]\\d{4}/.test(c0)) return c0;
            }
          }
          var td = node.closest && node.closest('td');
          if (td && td.parentElement && td.parentElement.parentElement) {
            var tbl = td.closest('table');
            var thead = tbl ? tbl.querySelector('thead') : null;
            if (thead) {
              var hr = thead.querySelector('tr');
              if (hr && hr.cells && td.cellIndex >= 0 && hr.cells[td.cellIndex]) {
                var hd = clean(hr.cells[td.cellIndex].innerText || '');
                if (/\\d/.test(hd)) return hd;
              }
            }
          }
          return '';
        }

        function buildEvent(rawText, fallbackDate, index, contextMonthOverride) {
          var lines = (rawText || '').split('\\n').map(clean).filter(Boolean);
          var text = clean(rawText);
          if (!isMeaningfulEvent(text, lines.slice(1).join(' '), '')) return null;

          var fromBlob = extractDateFromBlob(text);
          var date = clean(fallbackDate || '') || fromBlob || extractDateFromBlob(lines.join(' '));

          var title = lines.find(function(line) {
            return hasLetters(line) && !line.includes('Nr lekcji:') && !line.includes('Sala:') && !/^\\d{1,2}[.]\\d{1,2}[.]\\d{4}$/.test(line) && !/^\\d{4}-\\d{2}-\\d{2}$/.test(line);
          }) || text;

          var description = lines.filter(function(line) {
            if (!line || line === title) return false;
            if (/^\\d{1,2}$/.test(line)) return false;
            if (line.replace(/^\\d{1,2}\\s+/, '') === title) return false;
            if (/^\\d{1,2}\\s*$/.test(line)) return false;
            return true;
          }).join(' ');

          var type = '';

          if (/sprawdzian/i.test(text)) type = 'Sprawdzian';
          else if (/kartk/i.test(text)) type = 'Kartkówka';
          else if (/egzamin/i.test(text)) type = 'Egzamin';
          else if (/wyciecz/i.test(text)) type = 'Wycieczka';

          if (!date) {
            date = extractDateFromBlob(title + ' ' + description);
          }

          var ctxMonth = contextMonthOverride || PAGE_MONTH_ISO;

          return {
            id: ['event', date, title, description, type, index].join('|'),
            title: title,
            description: description,
            date: date,
            type: type,
            contextMonth: ctxMonth
          };
        }

        function ymFromKalendarzTable(tbl) {
          if (!tbl) return null;
          var ms = tbl.querySelector('select[name="miesiac"]');
          var ys = tbl.querySelector('select[name="rok"]');
          if (!ms || !ys) return null;
          var m = parseInt(ms.value, 10);
          var y = parseInt(ys.value, 10);
          if (!(m >= 1 && m <= 12) || !(y >= 1990 && y <= 2100)) return null;
          return { y: y, m: m };
        }

        function scrapeSynergiaKalendarzGridInto(arr) {
          var calTable = document.querySelector('table.kalendarz');
          if (!calTable) return;
          var ym = ymFromKalendarzTable(calTable);
          var pym = PAGE_MONTH_ISO.split('-');
          var y = ym ? ym.y : parseInt(pym[0], 10);
          var mo = ym ? ym.m : parseInt(pym[1], 10);
          if (!(y >= 1990 && y <= 2100) || !(mo >= 1 && mo <= 12)) return;
          var ctxStr = y + '-' + padMonthPart(mo);

          calTable.querySelectorAll('tbody tr td').forEach(function(td) {
            var dzien = td.querySelector('.kalendarz-dzien');
            if (!dzien) return;
            var numEl = dzien.querySelector('.kalendarz-numer-dnia');
            if (!numEl) return;
            var dayNum = parseInt(clean(numEl.innerText), 10);
            if (!(dayNum >= 1 && dayNum <= 31)) return;

            var isoDate = y + '-' + padMonthPart(mo) + '-' + padMonthPart(dayNum);
            var innerTds = dzien.querySelectorAll('table tbody tr td');
            var baseIdx = arr.length;
            innerTds.forEach(function(evTd, j) {
              var text = clean(evTd.innerText || evTd.textContent || '');
              if (!text) return;
              var ev = buildEvent(text, isoDate, baseIdx + j, ctxStr);
              if (ev) arr.push(ev);
            });
          });
        }

        var wydarzenia = [];
        scrapeSynergiaKalendarzGridInto(wydarzenia);
        var fcSelectors =
          '.fc-daygrid-event, .fc-timegrid-event, .fc-list-event, .fc-event-main, .fc-event-draggable, .fc-event';
        var legacySelectors =
          '.event-item, [data-event-id], .terminarz .event, .calendar-event, .terminarz-event';
        var eventNodes = document.querySelectorAll(fcSelectors + ', ' + legacySelectors);

        eventNodes.forEach(function(node, index) {
          var text = node.innerText || node.textContent || '';
          var fallbackDate = findDateNearNode(node);
          var event = buildEvent(text, fallbackDate, index);
          if (event) wydarzenia.push(event);
        });

        var items = document.querySelectorAll('table.decorated tbody tr, table tbody tr');
        
        items.forEach(function(item, index) {
          if (item.closest && item.closest('table.kalendarz')) return;
          var cells = item.querySelectorAll('td');
          if (cells.length >= 2) {
            var date = cells[0] ? clean(cells[0].innerText) : '';
            var title = cells[1] ? clean(cells[1].innerText) : '';
            var description = cells[2] ? clean(cells[2].innerText) : '';
            var type = cells[3] ? clean(cells[3].innerText) : '';
            if (!extractDateFromBlob(date)) {
              date =
                extractDateFromBlob(title + ' ' + description + ' ' + type) ||
                date;
            }
            var id =
              item.getAttribute('data-event-id') ||
              ['event', date, title, description, type].join('|');

            if (isMeaningfulEvent(title, description, type)) {
              wydarzenia.push({
                id: id,
                title: title,
                description: description,
                date: date,
                type: type,
                contextMonth: PAGE_MONTH_ISO
              });
            }
          }
        });
        
        return JSON.stringify(wydarzenia);
      })();
    `;
  }

  // Konwersja surowych danych na typowane modele
  parseGrades(rawData: any[]): GradesBySubject[] {
    if (!Array.isArray(rawData)) return [];
    
    return rawData.map(item => ({
      subject: item.przedmiot || item.subject,
      grades: (item.oceny || item.grades || []).map((g: any) => {
        const row: Grade = {
          id: g.id || '',
          subject: item.przedmiot || item.subject,
          value: g.value || g,
          description: g.description || '',
          date: g.date || '',
          teacher: g.teacher || '',
          weight: g.weight || '',
          category: g.category || '',
          isNew: g.isNew || false,
        };
        /** Zawsze z pola date/opis/id — żeby poprawione reguły semestrów działały po sync. */
        row.dateISO = deriveGradeDateISO(row);
        return row;
      }),
    }));
  }

  parseMessages(rawData: any[]): Message[] {
    if (!Array.isArray(rawData)) return [];
    return rawData
      .filter(item => item && item.id !== 'scraper-error')
      .map((item: any) => ({
        id: String(item.id ?? ''),
        sender: String(item.sender ?? ''),
        subject: String(item.subject ?? ''),
        date: String(item.date ?? ''),
        isRead: item.isRead !== false,
        isNew: Boolean(item.isNew),
        preview:
          item.preview != null ? String(item.preview) : undefined,
        hasAttachment: Boolean(item.hasAttachment),
        body: item.body != null ? String(item.body) : undefined,
        sendDateIso:
          item.sendDateIso != null ? String(item.sendDateIso) : undefined
      }));
  }

  parseNotes(rawData: any[]): Note[] {
    if (!Array.isArray(rawData)) return [];
    return rawData as Note[];
  }

  parseAnnouncements(rawData: any[]): Announcement[] {
    if (!Array.isArray(rawData)) return [];
    return rawData as Announcement[];
  }

  parseCalendar(rawData: any[]): CalendarEvent[] {
    if (!Array.isArray(rawData)) return [];
    const out: CalendarEvent[] = [];
    rawData.forEach((item: any) => {
      const enriched = enrichCalendarEvent({
        id: String(item.id ?? ''),
        title: String(item.title ?? ''),
        description:
          item.description != null ? String(item.description) : undefined,
        date: String(item.date ?? ''),
        startTime:
          item.startTime != null ? String(item.startTime) : undefined,
        endTime: item.endTime != null ? String(item.endTime) : undefined,
        type: item.type != null ? String(item.type) : undefined,
        contextMonth:
          item.contextMonth != null ? String(item.contextMonth) : undefined,
        isNew: Boolean(item.isNew)
      });
      enriched.forEach(ev => out.push(ev));
    });
    return out;
  }
}
