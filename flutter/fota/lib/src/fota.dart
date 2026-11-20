/// Download / install state reported by the native updater.
enum FotaUpdateStatus { idle, checking, downloading, readyToInstall, upToDate, failed }

/// Entry point for the optional Dart API.
///
/// Backed by the native updater through FFI (roadmap phase 5). Until then every
/// call reports that no patch is active.
class Fota {
  const Fota._();

  static const instance = Fota._();

  /// Patch number running right now, or `null` when running the bundled code.
  Future<int?> currentPatchNumber() async => null;

  /// Asks the server for a new patch. Returns `true` if one was downloaded and
  /// will be applied on the next cold start.
  Future<bool> checkForUpdate() async => false;

  /// Stream of updater state changes.
  Stream<FotaUpdateStatus> get status => const Stream.empty();
}
