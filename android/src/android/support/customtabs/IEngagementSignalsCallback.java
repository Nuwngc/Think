/*
 * This file is auto-generated.  DO NOT MODIFY.
 */
package android.support.customtabs;
/**
 * Interface to an EngagementSignalsCallback.
 */
public interface IEngagementSignalsCallback extends android.os.IInterface
{
  /** Default implementation for IEngagementSignalsCallback. */
  public static class Default implements android.support.customtabs.IEngagementSignalsCallback
  {
    @Override public void onVerticalScrollEvent(boolean isDirectionUp, android.os.Bundle extras) throws android.os.RemoteException
    {
    }
    @Override public void onGreatestScrollPercentageIncreased(int scrollPercentage, android.os.Bundle extras) throws android.os.RemoteException
    {
    }
    @Override public void onSessionEnded(boolean didUserInteract, android.os.Bundle extras) throws android.os.RemoteException
    {
    }
    @Override
    public android.os.IBinder asBinder() {
      return null;
    }
  }
  /** Local-side IPC implementation stub class. */
  public static abstract class Stub extends android.os.Binder implements android.support.customtabs.IEngagementSignalsCallback
  {
    private static final java.lang.String DESCRIPTOR = "android.support.customtabs.IEngagementSignalsCallback";
    /** Construct the stub at attach it to the interface. */
    public Stub()
    {
      this.attachInterface(this, DESCRIPTOR);
    }
    /**
     * Cast an IBinder object into an android.support.customtabs.IEngagementSignalsCallback interface,
     * generating a proxy if needed.
     */
    public static android.support.customtabs.IEngagementSignalsCallback asInterface(android.os.IBinder obj)
    {
      if ((obj==null)) {
        return null;
      }
      android.os.IInterface iin = obj.queryLocalInterface(DESCRIPTOR);
      if (((iin!=null)&&(iin instanceof android.support.customtabs.IEngagementSignalsCallback))) {
        return ((android.support.customtabs.IEngagementSignalsCallback)iin);
      }
      return new android.support.customtabs.IEngagementSignalsCallback.Stub.Proxy(obj);
    }
    @Override public android.os.IBinder asBinder()
    {
      return this;
    }
    @Override public boolean onTransact(int code, android.os.Parcel data, android.os.Parcel reply, int flags) throws android.os.RemoteException
    {
      java.lang.String descriptor = DESCRIPTOR;
      switch (code)
      {
        case INTERFACE_TRANSACTION:
        {
          reply.writeString(descriptor);
          return true;
        }
        case TRANSACTION_onVerticalScrollEvent:
        {
          data.enforceInterface(descriptor);
          boolean _arg0;
          _arg0 = (0!=data.readInt());
          android.os.Bundle _arg1;
          if ((0!=data.readInt())) {
            _arg1 = android.os.Bundle.CREATOR.createFromParcel(data);
          }
          else {
            _arg1 = null;
          }
          this.onVerticalScrollEvent(_arg0, _arg1);
          return true;
        }
        case TRANSACTION_onGreatestScrollPercentageIncreased:
        {
          data.enforceInterface(descriptor);
          int _arg0;
          _arg0 = data.readInt();
          android.os.Bundle _arg1;
          if ((0!=data.readInt())) {
            _arg1 = android.os.Bundle.CREATOR.createFromParcel(data);
          }
          else {
            _arg1 = null;
          }
          this.onGreatestScrollPercentageIncreased(_arg0, _arg1);
          return true;
        }
        case TRANSACTION_onSessionEnded:
        {
          data.enforceInterface(descriptor);
          boolean _arg0;
          _arg0 = (0!=data.readInt());
          android.os.Bundle _arg1;
          if ((0!=data.readInt())) {
            _arg1 = android.os.Bundle.CREATOR.createFromParcel(data);
          }
          else {
            _arg1 = null;
          }
          this.onSessionEnded(_arg0, _arg1);
          return true;
        }
        default:
        {
          return super.onTransact(code, data, reply, flags);
        }
      }
    }
    private static class Proxy implements android.support.customtabs.IEngagementSignalsCallback
    {
      private android.os.IBinder mRemote;
      Proxy(android.os.IBinder remote)
      {
        mRemote = remote;
      }
      @Override public android.os.IBinder asBinder()
      {
        return mRemote;
      }
      public java.lang.String getInterfaceDescriptor()
      {
        return DESCRIPTOR;
      }
      @Override public void onVerticalScrollEvent(boolean isDirectionUp, android.os.Bundle extras) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeInt(((isDirectionUp)?(1):(0)));
          if ((extras!=null)) {
            _data.writeInt(1);
            extras.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          boolean _status = mRemote.transact(Stub.TRANSACTION_onVerticalScrollEvent, _data, null, android.os.IBinder.FLAG_ONEWAY);
          if (!_status && getDefaultImpl() != null) {
            getDefaultImpl().onVerticalScrollEvent(isDirectionUp, extras);
            return;
          }
        }
        finally {
          _data.recycle();
        }
      }
      @Override public void onGreatestScrollPercentageIncreased(int scrollPercentage, android.os.Bundle extras) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeInt(scrollPercentage);
          if ((extras!=null)) {
            _data.writeInt(1);
            extras.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          boolean _status = mRemote.transact(Stub.TRANSACTION_onGreatestScrollPercentageIncreased, _data, null, android.os.IBinder.FLAG_ONEWAY);
          if (!_status && getDefaultImpl() != null) {
            getDefaultImpl().onGreatestScrollPercentageIncreased(scrollPercentage, extras);
            return;
          }
        }
        finally {
          _data.recycle();
        }
      }
      @Override public void onSessionEnded(boolean didUserInteract, android.os.Bundle extras) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeInt(((didUserInteract)?(1):(0)));
          if ((extras!=null)) {
            _data.writeInt(1);
            extras.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          boolean _status = mRemote.transact(Stub.TRANSACTION_onSessionEnded, _data, null, android.os.IBinder.FLAG_ONEWAY);
          if (!_status && getDefaultImpl() != null) {
            getDefaultImpl().onSessionEnded(didUserInteract, extras);
            return;
          }
        }
        finally {
          _data.recycle();
        }
      }
      public static android.support.customtabs.IEngagementSignalsCallback sDefaultImpl;
    }
    static final int TRANSACTION_onVerticalScrollEvent = (android.os.IBinder.FIRST_CALL_TRANSACTION + 1);
    static final int TRANSACTION_onGreatestScrollPercentageIncreased = (android.os.IBinder.FIRST_CALL_TRANSACTION + 2);
    static final int TRANSACTION_onSessionEnded = (android.os.IBinder.FIRST_CALL_TRANSACTION + 3);
    public static boolean setDefaultImpl(android.support.customtabs.IEngagementSignalsCallback impl) {
      if (Stub.Proxy.sDefaultImpl == null && impl != null) {
        Stub.Proxy.sDefaultImpl = impl;
        return true;
      }
      return false;
    }
    public static android.support.customtabs.IEngagementSignalsCallback getDefaultImpl() {
      return Stub.Proxy.sDefaultImpl;
    }
  }
  public void onVerticalScrollEvent(boolean isDirectionUp, android.os.Bundle extras) throws android.os.RemoteException;
  public void onGreatestScrollPercentageIncreased(int scrollPercentage, android.os.Bundle extras) throws android.os.RemoteException;
  public void onSessionEnded(boolean didUserInteract, android.os.Bundle extras) throws android.os.RemoteException;
}
