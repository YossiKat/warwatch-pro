import TacticalMapView from '@/components/war-room/TacticalMapView';
import DriveDetectBanner from '@/components/war-room/DriveDetectBanner';
import { useDriveDetection } from '@/hooks/useDriveDetection';

const Index = () => {
  const { showPrompt, speedKmh, switchNow, dismiss } = useDriveDetection();

  return (
    <div className="w-full h-full">
      {showPrompt && (
        <DriveDetectBanner
          speedKmh={speedKmh}
          onSwitch={switchNow}
          onDismiss={dismiss}
        />
      )}
      <TacticalMapView />
    </div>
  );
};

export default Index;
