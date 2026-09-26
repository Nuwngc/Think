/*
 * This file is auto-generated.  DO NOT MODIFY.
 */
package android.support.customtabs;
/**
 * Interface to a CustomTabsService.
 */
public interface ICustomTabsService extends android.os.IInterface
{
  /** Default implementation for ICustomTabsService. */
  public static class Default implements android.support.customtabs.ICustomTabsService
  {
    @Override public boolean warmup(long flags) throws android.os.RemoteException
    {
      return false;
    }
    @Override public boolean newSession(android.support.customtabs.ICustomTabsCallback callback) throws android.os.RemoteException
    {
      return false;
    }
    @Override public boolean newSessionWithExtras(android.support.customtabs.ICustomTabsCallback callback, android.os.Bundle extras) throws android.os.RemoteException
    {
      return false;
    }
    @Override public boolean mayLaunchUrl(android.support.customtabs.ICustomTabsCallback callback, android.net.Uri url, android.os.Bundle extras, java.util.List<android.os.Bundle> otherLikelyBundles) throws android.os.RemoteException
    {
      return false;
    }
    @Override public void prefetch(android.support.customtabs.ICustomTabsCallback callback, android.net.Uri url, android.os.Bundle options) throws android.os.RemoteException
    {
    }
    @Override public void prefetchWithMultipleUrls(android.support.customtabs.ICustomTabsCallback callback, java.util.List<android.net.Uri> urls, android.os.Bundle options) throws android.os.RemoteException
    {
    }
    @Override public android.os.Bundle extraCommand(java.lang.String commandName, android.os.Bundle args) throws android.os.RemoteException
    {
      return null;
    }
    @Override public boolean updateVisuals(android.support.customtabs.ICustomTabsCallback callback, android.os.Bundle bundle) throws android.os.RemoteException
    {
      return false;
    }
    @Override public boolean requestPostMessageChannel(android.support.customtabs.ICustomTabsCallback callback, android.net.Uri postMessageOrigin) throws android.os.RemoteException
    {
      return false;
    }
    @Override public boolean requestPostMessageChannelWithExtras(android.support.customtabs.ICustomTabsCallback callback, android.net.Uri postMessageOrigin, android.os.Bundle extras) throws android.os.RemoteException
    {
      return false;
    }
    @Override public int postMessage(android.support.customtabs.ICustomTabsCallback callback, java.lang.String message, android.os.Bundle extras) throws android.os.RemoteException
    {
      return 0;
    }
    @Override public boolean validateRelationship(android.support.customtabs.ICustomTabsCallback callback, int relation, android.net.Uri origin, android.os.Bundle extras) throws android.os.RemoteException
    {
      return false;
    }
    @Override public boolean receiveFile(android.support.customtabs.ICustomTabsCallback callback, android.net.Uri uri, int purpose, android.os.Bundle extras) throws android.os.RemoteException
    {
      return false;
    }
    @Override public boolean isEngagementSignalsApiAvailable(android.support.customtabs.ICustomTabsCallback customTabsCallback, android.os.Bundle extras) throws android.os.RemoteException
    {
      return false;
    }
    @Override public boolean setEngagementSignalsCallback(android.support.customtabs.ICustomTabsCallback customTabsCallback, android.os.IBinder callback, android.os.Bundle extras) throws android.os.RemoteException
    {
      return false;
    }
    @Override public boolean newAuthTabSession(android.support.customtabs.IAuthTabCallback callback, android.os.Bundle extras) throws android.os.RemoteException
    {
      return false;
    }
    @Override
    public android.os.IBinder asBinder() {
      return null;
    }
  }
  /** Local-side IPC implementation stub class. */
  public static abstract class Stub extends android.os.Binder implements android.support.customtabs.ICustomTabsService
  {
    private static final java.lang.String DESCRIPTOR = "android.support.customtabs.ICustomTabsService";
    /** Construct the stub at attach it to the interface. */
    public Stub()
    {
      this.attachInterface(this, DESCRIPTOR);
    }
    /**
     * Cast an IBinder object into an android.support.customtabs.ICustomTabsService interface,
     * generating a proxy if needed.
     */
    public static android.support.customtabs.ICustomTabsService asInterface(android.os.IBinder obj)
    {
      if ((obj==null)) {
        return null;
      }
      android.os.IInterface iin = obj.queryLocalInterface(DESCRIPTOR);
      if (((iin!=null)&&(iin instanceof android.support.customtabs.ICustomTabsService))) {
        return ((android.support.customtabs.ICustomTabsService)iin);
      }
      return new android.support.customtabs.ICustomTabsService.Stub.Proxy(obj);
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
        case TRANSACTION_warmup:
        {
          data.enforceInterface(descriptor);
          long _arg0;
          _arg0 = data.readLong();
          boolean _result = this.warmup(_arg0);
          reply.writeNoException();
          reply.writeInt(((_result)?(1):(0)));
          return true;
        }
        case TRANSACTION_newSession:
        {
          data.enforceInterface(descriptor);
          android.support.customtabs.ICustomTabsCallback _arg0;
          _arg0 = android.support.customtabs.ICustomTabsCallback.Stub.asInterface(data.readStrongBinder());
          boolean _result = this.newSession(_arg0);
          reply.writeNoException();
          reply.writeInt(((_result)?(1):(0)));
          return true;
        }
        case TRANSACTION_newSessionWithExtras:
        {
          data.enforceInterface(descriptor);
          android.support.customtabs.ICustomTabsCallback _arg0;
          _arg0 = android.support.customtabs.ICustomTabsCallback.Stub.asInterface(data.readStrongBinder());
          android.os.Bundle _arg1;
          if ((0!=data.readInt())) {
            _arg1 = android.os.Bundle.CREATOR.createFromParcel(data);
          }
          else {
            _arg1 = null;
          }
          boolean _result = this.newSessionWithExtras(_arg0, _arg1);
          reply.writeNoException();
          reply.writeInt(((_result)?(1):(0)));
          return true;
        }
        case TRANSACTION_mayLaunchUrl:
        {
          data.enforceInterface(descriptor);
          android.support.customtabs.ICustomTabsCallback _arg0;
          _arg0 = android.support.customtabs.ICustomTabsCallback.Stub.asInterface(data.readStrongBinder());
          android.net.Uri _arg1;
          if ((0!=data.readInt())) {
            _arg1 = android.net.Uri.CREATOR.createFromParcel(data);
          }
          else {
            _arg1 = null;
          }
          android.os.Bundle _arg2;
          if ((0!=data.readInt())) {
            _arg2 = android.os.Bundle.CREATOR.createFromParcel(data);
          }
          else {
            _arg2 = null;
          }
          java.util.List<android.os.Bundle> _arg3;
          _arg3 = data.createTypedArrayList(android.os.Bundle.CREATOR);
          boolean _result = this.mayLaunchUrl(_arg0, _arg1, _arg2, _arg3);
          reply.writeNoException();
          reply.writeInt(((_result)?(1):(0)));
          return true;
        }
        case TRANSACTION_prefetch:
        {
          data.enforceInterface(descriptor);
          android.support.customtabs.ICustomTabsCallback _arg0;
          _arg0 = android.support.customtabs.ICustomTabsCallback.Stub.asInterface(data.readStrongBinder());
          android.net.Uri _arg1;
          if ((0!=data.readInt())) {
            _arg1 = android.net.Uri.CREATOR.createFromParcel(data);
          }
          else {
            _arg1 = null;
          }
          android.os.Bundle _arg2;
          if ((0!=data.readInt())) {
            _arg2 = android.os.Bundle.CREATOR.createFromParcel(data);
          }
          else {
            _arg2 = null;
          }
          this.prefetch(_arg0, _arg1, _arg2);
          reply.writeNoException();
          return true;
        }
        case TRANSACTION_prefetchWithMultipleUrls:
        {
          data.enforceInterface(descriptor);
          android.support.customtabs.ICustomTabsCallback _arg0;
          _arg0 = android.support.customtabs.ICustomTabsCallback.Stub.asInterface(data.readStrongBinder());
          java.util.List<android.net.Uri> _arg1;
          _arg1 = data.createTypedArrayList(android.net.Uri.CREATOR);
          android.os.Bundle _arg2;
          if ((0!=data.readInt())) {
            _arg2 = android.os.Bundle.CREATOR.createFromParcel(data);
          }
          else {
            _arg2 = null;
          }
          this.prefetchWithMultipleUrls(_arg0, _arg1, _arg2);
          reply.writeNoException();
          return true;
        }
        case TRANSACTION_extraCommand:
        {
          data.enforceInterface(descriptor);
          java.lang.String _arg0;
          _arg0 = data.readString();
          android.os.Bundle _arg1;
          if ((0!=data.readInt())) {
            _arg1 = android.os.Bundle.CREATOR.createFromParcel(data);
          }
          else {
            _arg1 = null;
          }
          android.os.Bundle _result = this.extraCommand(_arg0, _arg1);
          reply.writeNoException();
          if ((_result!=null)) {
            reply.writeInt(1);
            _result.writeToParcel(reply, android.os.Parcelable.PARCELABLE_WRITE_RETURN_VALUE);
          }
          else {
            reply.writeInt(0);
          }
          return true;
        }
        case TRANSACTION_updateVisuals:
        {
          data.enforceInterface(descriptor);
          android.support.customtabs.ICustomTabsCallback _arg0;
          _arg0 = android.support.customtabs.ICustomTabsCallback.Stub.asInterface(data.readStrongBinder());
          android.os.Bundle _arg1;
          if ((0!=data.readInt())) {
            _arg1 = android.os.Bundle.CREATOR.createFromParcel(data);
          }
          else {
            _arg1 = null;
          }
          boolean _result = this.updateVisuals(_arg0, _arg1);
          reply.writeNoException();
          reply.writeInt(((_result)?(1):(0)));
          return true;
        }
        case TRANSACTION_requestPostMessageChannel:
        {
          data.enforceInterface(descriptor);
          android.support.customtabs.ICustomTabsCallback _arg0;
          _arg0 = android.support.customtabs.ICustomTabsCallback.Stub.asInterface(data.readStrongBinder());
          android.net.Uri _arg1;
          if ((0!=data.readInt())) {
            _arg1 = android.net.Uri.CREATOR.createFromParcel(data);
          }
          else {
            _arg1 = null;
          }
          boolean _result = this.requestPostMessageChannel(_arg0, _arg1);
          reply.writeNoException();
          reply.writeInt(((_result)?(1):(0)));
          return true;
        }
        case TRANSACTION_requestPostMessageChannelWithExtras:
        {
          data.enforceInterface(descriptor);
          android.support.customtabs.ICustomTabsCallback _arg0;
          _arg0 = android.support.customtabs.ICustomTabsCallback.Stub.asInterface(data.readStrongBinder());
          android.net.Uri _arg1;
          if ((0!=data.readInt())) {
            _arg1 = android.net.Uri.CREATOR.createFromParcel(data);
          }
          else {
            _arg1 = null;
          }
          android.os.Bundle _arg2;
          if ((0!=data.readInt())) {
            _arg2 = android.os.Bundle.CREATOR.createFromParcel(data);
          }
          else {
            _arg2 = null;
          }
          boolean _result = this.requestPostMessageChannelWithExtras(_arg0, _arg1, _arg2);
          reply.writeNoException();
          reply.writeInt(((_result)?(1):(0)));
          return true;
        }
        case TRANSACTION_postMessage:
        {
          data.enforceInterface(descriptor);
          android.support.customtabs.ICustomTabsCallback _arg0;
          _arg0 = android.support.customtabs.ICustomTabsCallback.Stub.asInterface(data.readStrongBinder());
          java.lang.String _arg1;
          _arg1 = data.readString();
          android.os.Bundle _arg2;
          if ((0!=data.readInt())) {
            _arg2 = android.os.Bundle.CREATOR.createFromParcel(data);
          }
          else {
            _arg2 = null;
          }
          int _result = this.postMessage(_arg0, _arg1, _arg2);
          reply.writeNoException();
          reply.writeInt(_result);
          return true;
        }
        case TRANSACTION_validateRelationship:
        {
          data.enforceInterface(descriptor);
          android.support.customtabs.ICustomTabsCallback _arg0;
          _arg0 = android.support.customtabs.ICustomTabsCallback.Stub.asInterface(data.readStrongBinder());
          int _arg1;
          _arg1 = data.readInt();
          android.net.Uri _arg2;
          if ((0!=data.readInt())) {
            _arg2 = android.net.Uri.CREATOR.createFromParcel(data);
          }
          else {
            _arg2 = null;
          }
          android.os.Bundle _arg3;
          if ((0!=data.readInt())) {
            _arg3 = android.os.Bundle.CREATOR.createFromParcel(data);
          }
          else {
            _arg3 = null;
          }
          boolean _result = this.validateRelationship(_arg0, _arg1, _arg2, _arg3);
          reply.writeNoException();
          reply.writeInt(((_result)?(1):(0)));
          return true;
        }
        case TRANSACTION_receiveFile:
        {
          data.enforceInterface(descriptor);
          android.support.customtabs.ICustomTabsCallback _arg0;
          _arg0 = android.support.customtabs.ICustomTabsCallback.Stub.asInterface(data.readStrongBinder());
          android.net.Uri _arg1;
          if ((0!=data.readInt())) {
            _arg1 = android.net.Uri.CREATOR.createFromParcel(data);
          }
          else {
            _arg1 = null;
          }
          int _arg2;
          _arg2 = data.readInt();
          android.os.Bundle _arg3;
          if ((0!=data.readInt())) {
            _arg3 = android.os.Bundle.CREATOR.createFromParcel(data);
          }
          else {
            _arg3 = null;
          }
          boolean _result = this.receiveFile(_arg0, _arg1, _arg2, _arg3);
          reply.writeNoException();
          reply.writeInt(((_result)?(1):(0)));
          return true;
        }
        case TRANSACTION_isEngagementSignalsApiAvailable:
        {
          data.enforceInterface(descriptor);
          android.support.customtabs.ICustomTabsCallback _arg0;
          _arg0 = android.support.customtabs.ICustomTabsCallback.Stub.asInterface(data.readStrongBinder());
          android.os.Bundle _arg1;
          if ((0!=data.readInt())) {
            _arg1 = android.os.Bundle.CREATOR.createFromParcel(data);
          }
          else {
            _arg1 = null;
          }
          boolean _result = this.isEngagementSignalsApiAvailable(_arg0, _arg1);
          reply.writeNoException();
          reply.writeInt(((_result)?(1):(0)));
          return true;
        }
        case TRANSACTION_setEngagementSignalsCallback:
        {
          data.enforceInterface(descriptor);
          android.support.customtabs.ICustomTabsCallback _arg0;
          _arg0 = android.support.customtabs.ICustomTabsCallback.Stub.asInterface(data.readStrongBinder());
          android.os.IBinder _arg1;
          _arg1 = data.readStrongBinder();
          android.os.Bundle _arg2;
          if ((0!=data.readInt())) {
            _arg2 = android.os.Bundle.CREATOR.createFromParcel(data);
          }
          else {
            _arg2 = null;
          }
          boolean _result = this.setEngagementSignalsCallback(_arg0, _arg1, _arg2);
          reply.writeNoException();
          reply.writeInt(((_result)?(1):(0)));
          return true;
        }
        case TRANSACTION_newAuthTabSession:
        {
          data.enforceInterface(descriptor);
          android.support.customtabs.IAuthTabCallback _arg0;
          _arg0 = android.support.customtabs.IAuthTabCallback.Stub.asInterface(data.readStrongBinder());
          android.os.Bundle _arg1;
          if ((0!=data.readInt())) {
            _arg1 = android.os.Bundle.CREATOR.createFromParcel(data);
          }
          else {
            _arg1 = null;
          }
          boolean _result = this.newAuthTabSession(_arg0, _arg1);
          reply.writeNoException();
          reply.writeInt(((_result)?(1):(0)));
          return true;
        }
        default:
        {
          return super.onTransact(code, data, reply, flags);
        }
      }
    }
    private static class Proxy implements android.support.customtabs.ICustomTabsService
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
      @Override public boolean warmup(long flags) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        boolean _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeLong(flags);
          boolean _status = mRemote.transact(Stub.TRANSACTION_warmup, _data, _reply, 0);
          if (!_status && getDefaultImpl() != null) {
            return getDefaultImpl().warmup(flags);
          }
          _reply.readException();
          _result = (0!=_reply.readInt());
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public boolean newSession(android.support.customtabs.ICustomTabsCallback callback) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        boolean _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeStrongBinder((((callback!=null))?(callback.asBinder()):(null)));
          boolean _status = mRemote.transact(Stub.TRANSACTION_newSession, _data, _reply, 0);
          if (!_status && getDefaultImpl() != null) {
            return getDefaultImpl().newSession(callback);
          }
          _reply.readException();
          _result = (0!=_reply.readInt());
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public boolean newSessionWithExtras(android.support.customtabs.ICustomTabsCallback callback, android.os.Bundle extras) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        boolean _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeStrongBinder((((callback!=null))?(callback.asBinder()):(null)));
          if ((extras!=null)) {
            _data.writeInt(1);
            extras.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          boolean _status = mRemote.transact(Stub.TRANSACTION_newSessionWithExtras, _data, _reply, 0);
          if (!_status && getDefaultImpl() != null) {
            return getDefaultImpl().newSessionWithExtras(callback, extras);
          }
          _reply.readException();
          _result = (0!=_reply.readInt());
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public boolean mayLaunchUrl(android.support.customtabs.ICustomTabsCallback callback, android.net.Uri url, android.os.Bundle extras, java.util.List<android.os.Bundle> otherLikelyBundles) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        boolean _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeStrongBinder((((callback!=null))?(callback.asBinder()):(null)));
          if ((url!=null)) {
            _data.writeInt(1);
            url.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          if ((extras!=null)) {
            _data.writeInt(1);
            extras.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          _data.writeTypedList(otherLikelyBundles);
          boolean _status = mRemote.transact(Stub.TRANSACTION_mayLaunchUrl, _data, _reply, 0);
          if (!_status && getDefaultImpl() != null) {
            return getDefaultImpl().mayLaunchUrl(callback, url, extras, otherLikelyBundles);
          }
          _reply.readException();
          _result = (0!=_reply.readInt());
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public void prefetch(android.support.customtabs.ICustomTabsCallback callback, android.net.Uri url, android.os.Bundle options) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeStrongBinder((((callback!=null))?(callback.asBinder()):(null)));
          if ((url!=null)) {
            _data.writeInt(1);
            url.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          if ((options!=null)) {
            _data.writeInt(1);
            options.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          boolean _status = mRemote.transact(Stub.TRANSACTION_prefetch, _data, _reply, 0);
          if (!_status && getDefaultImpl() != null) {
            getDefaultImpl().prefetch(callback, url, options);
            return;
          }
          _reply.readException();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
      }
      @Override public void prefetchWithMultipleUrls(android.support.customtabs.ICustomTabsCallback callback, java.util.List<android.net.Uri> urls, android.os.Bundle options) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeStrongBinder((((callback!=null))?(callback.asBinder()):(null)));
          _data.writeTypedList(urls);
          if ((options!=null)) {
            _data.writeInt(1);
            options.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          boolean _status = mRemote.transact(Stub.TRANSACTION_prefetchWithMultipleUrls, _data, _reply, 0);
          if (!_status && getDefaultImpl() != null) {
            getDefaultImpl().prefetchWithMultipleUrls(callback, urls, options);
            return;
          }
          _reply.readException();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
      }
      @Override public android.os.Bundle extraCommand(java.lang.String commandName, android.os.Bundle args) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        android.os.Bundle _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeString(commandName);
          if ((args!=null)) {
            _data.writeInt(1);
            args.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          boolean _status = mRemote.transact(Stub.TRANSACTION_extraCommand, _data, _reply, 0);
          if (!_status && getDefaultImpl() != null) {
            return getDefaultImpl().extraCommand(commandName, args);
          }
          _reply.readException();
          if ((0!=_reply.readInt())) {
            _result = android.os.Bundle.CREATOR.createFromParcel(_reply);
          }
          else {
            _result = null;
          }
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public boolean updateVisuals(android.support.customtabs.ICustomTabsCallback callback, android.os.Bundle bundle) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        boolean _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeStrongBinder((((callback!=null))?(callback.asBinder()):(null)));
          if ((bundle!=null)) {
            _data.writeInt(1);
            bundle.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          boolean _status = mRemote.transact(Stub.TRANSACTION_updateVisuals, _data, _reply, 0);
          if (!_status && getDefaultImpl() != null) {
            return getDefaultImpl().updateVisuals(callback, bundle);
          }
          _reply.readException();
          _result = (0!=_reply.readInt());
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public boolean requestPostMessageChannel(android.support.customtabs.ICustomTabsCallback callback, android.net.Uri postMessageOrigin) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        boolean _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeStrongBinder((((callback!=null))?(callback.asBinder()):(null)));
          if ((postMessageOrigin!=null)) {
            _data.writeInt(1);
            postMessageOrigin.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          boolean _status = mRemote.transact(Stub.TRANSACTION_requestPostMessageChannel, _data, _reply, 0);
          if (!_status && getDefaultImpl() != null) {
            return getDefaultImpl().requestPostMessageChannel(callback, postMessageOrigin);
          }
          _reply.readException();
          _result = (0!=_reply.readInt());
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public boolean requestPostMessageChannelWithExtras(android.support.customtabs.ICustomTabsCallback callback, android.net.Uri postMessageOrigin, android.os.Bundle extras) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        boolean _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeStrongBinder((((callback!=null))?(callback.asBinder()):(null)));
          if ((postMessageOrigin!=null)) {
            _data.writeInt(1);
            postMessageOrigin.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          if ((extras!=null)) {
            _data.writeInt(1);
            extras.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          boolean _status = mRemote.transact(Stub.TRANSACTION_requestPostMessageChannelWithExtras, _data, _reply, 0);
          if (!_status && getDefaultImpl() != null) {
            return getDefaultImpl().requestPostMessageChannelWithExtras(callback, postMessageOrigin, extras);
          }
          _reply.readException();
          _result = (0!=_reply.readInt());
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public int postMessage(android.support.customtabs.ICustomTabsCallback callback, java.lang.String message, android.os.Bundle extras) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        int _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeStrongBinder((((callback!=null))?(callback.asBinder()):(null)));
          _data.writeString(message);
          if ((extras!=null)) {
            _data.writeInt(1);
            extras.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          boolean _status = mRemote.transact(Stub.TRANSACTION_postMessage, _data, _reply, 0);
          if (!_status && getDefaultImpl() != null) {
            return getDefaultImpl().postMessage(callback, message, extras);
          }
          _reply.readException();
          _result = _reply.readInt();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public boolean validateRelationship(android.support.customtabs.ICustomTabsCallback callback, int relation, android.net.Uri origin, android.os.Bundle extras) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        boolean _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeStrongBinder((((callback!=null))?(callback.asBinder()):(null)));
          _data.writeInt(relation);
          if ((origin!=null)) {
            _data.writeInt(1);
            origin.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          if ((extras!=null)) {
            _data.writeInt(1);
            extras.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          boolean _status = mRemote.transact(Stub.TRANSACTION_validateRelationship, _data, _reply, 0);
          if (!_status && getDefaultImpl() != null) {
            return getDefaultImpl().validateRelationship(callback, relation, origin, extras);
          }
          _reply.readException();
          _result = (0!=_reply.readInt());
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public boolean receiveFile(android.support.customtabs.ICustomTabsCallback callback, android.net.Uri uri, int purpose, android.os.Bundle extras) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        boolean _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeStrongBinder((((callback!=null))?(callback.asBinder()):(null)));
          if ((uri!=null)) {
            _data.writeInt(1);
            uri.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          _data.writeInt(purpose);
          if ((extras!=null)) {
            _data.writeInt(1);
            extras.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          boolean _status = mRemote.transact(Stub.TRANSACTION_receiveFile, _data, _reply, 0);
          if (!_status && getDefaultImpl() != null) {
            return getDefaultImpl().receiveFile(callback, uri, purpose, extras);
          }
          _reply.readException();
          _result = (0!=_reply.readInt());
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public boolean isEngagementSignalsApiAvailable(android.support.customtabs.ICustomTabsCallback customTabsCallback, android.os.Bundle extras) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        boolean _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeStrongBinder((((customTabsCallback!=null))?(customTabsCallback.asBinder()):(null)));
          if ((extras!=null)) {
            _data.writeInt(1);
            extras.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          boolean _status = mRemote.transact(Stub.TRANSACTION_isEngagementSignalsApiAvailable, _data, _reply, 0);
          if (!_status && getDefaultImpl() != null) {
            return getDefaultImpl().isEngagementSignalsApiAvailable(customTabsCallback, extras);
          }
          _reply.readException();
          _result = (0!=_reply.readInt());
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public boolean setEngagementSignalsCallback(android.support.customtabs.ICustomTabsCallback customTabsCallback, android.os.IBinder callback, android.os.Bundle extras) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        boolean _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeStrongBinder((((customTabsCallback!=null))?(customTabsCallback.asBinder()):(null)));
          _data.writeStrongBinder(callback);
          if ((extras!=null)) {
            _data.writeInt(1);
            extras.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          boolean _status = mRemote.transact(Stub.TRANSACTION_setEngagementSignalsCallback, _data, _reply, 0);
          if (!_status && getDefaultImpl() != null) {
            return getDefaultImpl().setEngagementSignalsCallback(customTabsCallback, callback, extras);
          }
          _reply.readException();
          _result = (0!=_reply.readInt());
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public boolean newAuthTabSession(android.support.customtabs.IAuthTabCallback callback, android.os.Bundle extras) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        boolean _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeStrongBinder((((callback!=null))?(callback.asBinder()):(null)));
          if ((extras!=null)) {
            _data.writeInt(1);
            extras.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          boolean _status = mRemote.transact(Stub.TRANSACTION_newAuthTabSession, _data, _reply, 0);
          if (!_status && getDefaultImpl() != null) {
            return getDefaultImpl().newAuthTabSession(callback, extras);
          }
          _reply.readException();
          _result = (0!=_reply.readInt());
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      public static android.support.customtabs.ICustomTabsService sDefaultImpl;
    }
    static final int TRANSACTION_warmup = (android.os.IBinder.FIRST_CALL_TRANSACTION + 1);
    static final int TRANSACTION_newSession = (android.os.IBinder.FIRST_CALL_TRANSACTION + 2);
    static final int TRANSACTION_newSessionWithExtras = (android.os.IBinder.FIRST_CALL_TRANSACTION + 9);
    static final int TRANSACTION_mayLaunchUrl = (android.os.IBinder.FIRST_CALL_TRANSACTION + 3);
    static final int TRANSACTION_prefetch = (android.os.IBinder.FIRST_CALL_TRANSACTION + 14);
    static final int TRANSACTION_prefetchWithMultipleUrls = (android.os.IBinder.FIRST_CALL_TRANSACTION + 15);
    static final int TRANSACTION_extraCommand = (android.os.IBinder.FIRST_CALL_TRANSACTION + 4);
    static final int TRANSACTION_updateVisuals = (android.os.IBinder.FIRST_CALL_TRANSACTION + 5);
    static final int TRANSACTION_requestPostMessageChannel = (android.os.IBinder.FIRST_CALL_TRANSACTION + 6);
    static final int TRANSACTION_requestPostMessageChannelWithExtras = (android.os.IBinder.FIRST_CALL_TRANSACTION + 10);
    static final int TRANSACTION_postMessage = (android.os.IBinder.FIRST_CALL_TRANSACTION + 7);
    static final int TRANSACTION_validateRelationship = (android.os.IBinder.FIRST_CALL_TRANSACTION + 8);
    static final int TRANSACTION_receiveFile = (android.os.IBinder.FIRST_CALL_TRANSACTION + 11);
    static final int TRANSACTION_isEngagementSignalsApiAvailable = (android.os.IBinder.FIRST_CALL_TRANSACTION + 12);
    static final int TRANSACTION_setEngagementSignalsCallback = (android.os.IBinder.FIRST_CALL_TRANSACTION + 13);
    static final int TRANSACTION_newAuthTabSession = (android.os.IBinder.FIRST_CALL_TRANSACTION + 17);
    public static boolean setDefaultImpl(android.support.customtabs.ICustomTabsService impl) {
      if (Stub.Proxy.sDefaultImpl == null && impl != null) {
        Stub.Proxy.sDefaultImpl = impl;
        return true;
      }
      return false;
    }
    public static android.support.customtabs.ICustomTabsService getDefaultImpl() {
      return Stub.Proxy.sDefaultImpl;
    }
  }
  public boolean warmup(long flags) throws android.os.RemoteException;
  public boolean newSession(android.support.customtabs.ICustomTabsCallback callback) throws android.os.RemoteException;
  public boolean newSessionWithExtras(android.support.customtabs.ICustomTabsCallback callback, android.os.Bundle extras) throws android.os.RemoteException;
  public boolean mayLaunchUrl(android.support.customtabs.ICustomTabsCallback callback, android.net.Uri url, android.os.Bundle extras, java.util.List<android.os.Bundle> otherLikelyBundles) throws android.os.RemoteException;
  public void prefetch(android.support.customtabs.ICustomTabsCallback callback, android.net.Uri url, android.os.Bundle options) throws android.os.RemoteException;
  public void prefetchWithMultipleUrls(android.support.customtabs.ICustomTabsCallback callback, java.util.List<android.net.Uri> urls, android.os.Bundle options) throws android.os.RemoteException;
  public android.os.Bundle extraCommand(java.lang.String commandName, android.os.Bundle args) throws android.os.RemoteException;
  public boolean updateVisuals(android.support.customtabs.ICustomTabsCallback callback, android.os.Bundle bundle) throws android.os.RemoteException;
  public boolean requestPostMessageChannel(android.support.customtabs.ICustomTabsCallback callback, android.net.Uri postMessageOrigin) throws android.os.RemoteException;
  public boolean requestPostMessageChannelWithExtras(android.support.customtabs.ICustomTabsCallback callback, android.net.Uri postMessageOrigin, android.os.Bundle extras) throws android.os.RemoteException;
  public int postMessage(android.support.customtabs.ICustomTabsCallback callback, java.lang.String message, android.os.Bundle extras) throws android.os.RemoteException;
  public boolean validateRelationship(android.support.customtabs.ICustomTabsCallback callback, int relation, android.net.Uri origin, android.os.Bundle extras) throws android.os.RemoteException;
  public boolean receiveFile(android.support.customtabs.ICustomTabsCallback callback, android.net.Uri uri, int purpose, android.os.Bundle extras) throws android.os.RemoteException;
  public boolean isEngagementSignalsApiAvailable(android.support.customtabs.ICustomTabsCallback customTabsCallback, android.os.Bundle extras) throws android.os.RemoteException;
  public boolean setEngagementSignalsCallback(android.support.customtabs.ICustomTabsCallback customTabsCallback, android.os.IBinder callback, android.os.Bundle extras) throws android.os.RemoteException;
  public boolean newAuthTabSession(android.support.customtabs.IAuthTabCallback callback, android.os.Bundle extras) throws android.os.RemoteException;
}
