// bot-logic.js — DEPRECATED
//
// This file has been replaced by the following modules:
//
//   src/utils/parser.js          ← parseRowData()
//   src/utils/formatter.js       ← formatMessage(), formatTimestamp()
//   src/services/googleSheets.js ← Google auth, row fetching, cell writing
//   src/scheduler.js             ← syncSheetToScheduler(), getPendingMessages(), sendScheduledMessage()
//
// This file is safe to delete.
// Nothing in the project imports from it anymore — index.js now imports from ./src/scheduler.
