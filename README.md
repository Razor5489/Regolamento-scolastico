# NIGHTFALL RP — Regolamento Scolastico

Sito: https://razor5489.github.io/Regolamento-scolastico/

Contiene il Regolamento Scolastico, il Regolamento Professori e le Linee guida di Hogwarts (1890).

## Gestione con password

Il pulsante "Gestisci regolamento" utilizza la password ADMIN_PASSWORD configurata come segreto Vercel. Le modifiche vengono pubblicate nell'archivio privato Vercel Blob, non tramite un token GitHub.

Per leggere i contenuti aggiornati il sito chiama /api/document-public. La modifica avviene tramite /api/document, protetta dalla password. Il servizio conserva le revisioni e verifica che nessuno abbia modificato contemporaneamente il documento.

Il contenuto iniziale è importato una sola volta dal file regolamento.json del repository. Quel file rimane una copia pubblica di recupero, non la fonte dei salvataggi quotidiani. Dopo ogni salvataggio online basta ricaricare il sito per vedere gli aggiornamenti, senza attendere GitHub Pages.

## Configurazione Vercel

Variabili di ambiente richieste: ADMIN_PASSWORD e BLOB_READ_WRITE_TOKEN, mantenute private nelle impostazioni di Vercel.

GITHUB_TOKEN non è più utilizzato dall'editor del regolamento.

Il progetto Vercel ospita anche gli endpoint di Club e Orari: conservarli in ogni successiva pubblicazione.

Backend: https://nightfall-regolamento-professori.vercel.app/

*Creato per NightFall da Razor.*
