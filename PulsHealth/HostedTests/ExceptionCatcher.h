#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Runs the block and returns the NSException it raised, or nil.
/// Exists because HealthKit reports illegal statistics option×type combos by
/// raising NSInvalidArgumentException — unreachable from pure Swift.
NSException *_Nullable PulsCatchException(void (NS_NOESCAPE ^block)(void));

NS_ASSUME_NONNULL_END
