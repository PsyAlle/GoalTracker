// overflowMenu.js
import { el, openModal, toast } from './dom.js';
import { exportAllData, downloadExport, importAllData, resetAllData, readFileAsJson } from '../domain/exportImport.js';

export function openOverflowMenu(onDataChanged) {
  openModal((close) => {
    const fileInput = el('input', {
      type: 'file',
      accept: 'application/json',
      style: 'display:none',
      onChange: async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const parsed = await readFileAsJson(file);
          close();
          confirmImport(parsed, onDataChanged);
        } catch (err) {
          toast(err.message || 'Kunde inte läsa filen.');
        }
      },
    });

    return el('div', {}, [
      el('h2', { text: 'Datahantering' }),
      el('ul.menu-list', {}, [
        el('li', {}, [
          el('button', {
            text: 'Exportera data (backup / AI-analys)',
            onClick: async () => {
              const data = await exportAllData();
              downloadExport(data);
              toast('Export nedladdad.');
              close();
            },
          }),
        ]),
        el('li', {}, [
          el('button', {
            text: 'Importera data från backup',
            onClick: () => fileInput.click(),
          }),
          fileInput,
        ]),
        el('li', {}, [
          el('button.danger', {
            text: 'Återställ — radera all data',
            onClick: () => {
              close();
              confirmReset(onDataChanged);
            },
          }),
        ]),
      ]),
      el('div.modal-actions', {}, [el('button.btn.block', { text: 'Stäng', onClick: close })]),
    ]);
  });
}

function confirmImport(parsed, onDataChanged) {
  openModal((close) => {
    return el('div', {}, [
      el('h2', { text: 'Importera backup?' }),
      el('p', {
        text: 'Detta ersätter ALL nuvarande data i appen med innehållet i den valda filen. Går inte att ångra.',
      }),
      el('div.modal-actions', {}, [
        el('button.btn.danger.block', {
          text: 'Ja, ersätt all data',
          onClick: async () => {
            try {
              await importAllData(parsed);
              toast('Data importerad.');
              close();
              onDataChanged?.();
            } catch (err) {
              toast(err.message || 'Import misslyckades.');
            }
          },
        }),
        el('button.btn.block', { text: 'Avbryt', onClick: close }),
      ]),
    ]);
  });
}

function confirmReset(onDataChanged) {
  openModal((close) => {
    return el('div', {}, [
      el('h2', { text: 'Radera all data?' }),
      el('p', {
        text: 'Alla perioder, mål och registrerad progress raderas permanent. Exportera en backup först om du är osäker.',
      }),
      el('div.modal-actions', {}, [
        el('button.btn.danger.block', {
          text: 'Ja, radera allt',
          onClick: async () => {
            await resetAllData();
            toast('All data raderad.');
            close();
            onDataChanged?.();
          },
        }),
        el('button.btn.block', { text: 'Avbryt', onClick: close }),
      ]),
    ]);
  });
}
