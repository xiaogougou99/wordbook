window.WORDBOOK_CONFIG = Object.freeze({
  cloudApi: "https://api.keyval.org",
  legacyCloudKey: "vocab-sync-lTEn7zQSBNNfQaKQeyP0LPmrqApKa8yjRfzysaF0nlE",
  deviceSlotPrefix: "vocab-sync-lTEn7zQSBNNfQaKQeyP0LPmrqApKa8yjRfzysaF0nlE-slot",
  slotCount: 8,
  localDeletedKey: "wordbook.deleted.v4",
  deviceIdKey: "wordbook.device.v1",
  migrationMarkerKey: "wordbook.migrated.v4",
  knownLegacyStorageKeys: [
    "yihun_vocab_deleted_cloud_v3",
    "yihun_vocab_deleted_v2",
    "yihun_vocab_deleted",
    "vocab_deleted",
    "deletedWords",
    "deletedWordIds"
  ],
  syncIntervalMs: 90000,
  requestTimeoutMs: 10000
});
