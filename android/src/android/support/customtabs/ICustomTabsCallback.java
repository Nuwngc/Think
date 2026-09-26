/*
 * This file is auto-generated.  DO NOT MODIFY.
 */
package android.support.customtabs;
/**
 * Interface to a CustomTabsCallback.
 */
public interface ICustomTabsCallback extends android.os.IInterface
{
  /** Default implementation for ICustomTabsCallback. */
  public static class Default implements android.support.customtabs.ICustomTabsCallback
  {
    @Override public void onNavigationEvent(int navigationEvent, android.os.Bundle extras) throws android.os.RemoteException
    {
    }
    @Override public void extraCallback(java.lang.String callbackName, android.os.Bundle args) throws android.os.RemoteException
    {
    }
    // Not defined with 'oneway' to preserve the calling order among |onPostMessage()| and related calls.

    @Override public void onMessageChannelReady(android.os.Bundle extras) throws android.os.RemoteException
    {
    }
    @Override public void onPostMessage(java.lang.String message, android.os.Bundle extras) throws android.os.RemoteException
    {
    }
    @Override public void onRelationshipValidationResult(int relation, android.net.Uri origin, boolean result, android.os.Bundle extras) throws android.os.RemoteException
    {
    }
    // API with return value cannot be 'oneway'.

    @Override public android.os.Bundle extraCallbackWithResult(java.lang.String callbackName, android.os.Bundle args) throws android.os.RemoteException
    {
      return null;
    }
    @Override public void onActivityResized(int height, int width, android.os.Bundle extras) throws android.os.RemoteException
    {
    }
    @Override public void onWarmupCompleted(android.os.Bundle extras) throws android.os.RemoteException
    {
    }
    @Override public void onActivityLayout(int left, int top, int right, int bottom, int state, android.os.Bundle extras) throws android.os.RemoteException
    {
    }
    @Override public void onMinimized(android.os.Bundle extras) throws android.os.RemoteException
    {
    }
    @Override public void onUnminimized(android.os.Bundle extras) throws android.os.RemoteException
    {
    }
    @Override
    public android.os.IBinder asBinder() {
      return null;
    }
  }
  /** Local-side IPC implementation stub class. */
  public static abstract class Stub extends android.os.Binder implements android.support.customtabs.ICustomTabsCallback
  {
    private static final java.lang.String DESCRIPTOR = "android.support.customtabs.ICustomTabsCallback";
    /** Construct the stub at attach it to the interface. */
    public Stub()
    {
      this.attachInterface(this, DESCRIPTOR);
    }
    /**
     * Cast an IBinder object into an android.support.customtabs.ICustomTabsCallback interface,
     * generating a proxy if needed.
     */
    public static android.support.customtabs.ICustomTabsCallback asInterface(android.os.IBinder obj)
    {
      if ((obj==null)) {
        return null;
      }
      android.os.IInterface iin = obj.queryLocalInterface(DESCRIPTOR);
      if (((iin!=null)&&(iin instanceof android.support.customtabs.ICustomTabsCallback))) {
        return ((android.support.customtabs.ICustomTabsCallback)iin);
      }
      return new android.support.customtabs.ICustomTabsCallback.Stub.Proxy(obj);
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
        case TRANSACTION_onNavigationEvent:
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
          this.onNavigationEvent(_arg0, _arg1);
          return true;
        }
        case TRANSACTION_extraCallback:
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
          this.extraCallback(_arg0, _arg1);
          return true;
        }
        case TRANSACTION_onMessageChannelReady:
        {
          data.enforceInterface(descriptor);
          android.os.Bundle _arg0;
          if ((0!=data.readInt())) {
            _arg0 = android.os.Bundle.CREATOR.createFromParcel(data);
          }
          else {
            _arg0 = null;
          }
          this.onMessageChannelReady(_arg0);
          reply.writeNoException();
          return true;
        }
        case TRANSACTION_onPostMessage:
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
          this.onPostMessage(_arg0, _arg1);
          reply.writeNoException();
          return true;
        }
        case TRANSACTION_onRelationshipValidationResult:
        {
          data.enforceInterface(descriptor);
          int _arg0;
          _arg0 = data.readInt();
          android.net.Uri _arg1;
          if ((0!=data.readInt())) {
            _arg1 = android.net.Uri.CREATOR.createFromParcel(data);
          }
          else {
            _arg1 = null;
          }
          boolean _arg2;
          _arg2 = (0!=data.readInt());
          android.os.Bundle _arg3;
          if ((0!=data.readInt())) {
            _arg3 = android.os.Bundle.CREATOR.createFromParcel(data);
          }
          else {
            _arg3 = null;
          }
          this.onRelationshipValidationResult(_arg0, _arg1, _arg2, _arg3);
          return true;
        }
        case TRANSACTION_extraCallbackWithResult:
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
          android.os.Bundle _result = this.extraCallbackWithResult(_arg0, _arg1);
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
        case TRANSACTION_onActivityResized:
        {
          data.enforceInterface(descriptor);
          int _arg0;
          _arg0 = data.readInt();
          int _arg1;
          _arg1 = data.readInt();
          android.os.Bundle _arg2;
          if ((0!=data.readInt())) {
            _arg2 = android.os.Bundle.CREATOR.createFromParcel(data);
          }
          else {
            _arg2 = null;
          }
          this.onActivityResized(_arg0, _arg1, _arg2);
          return true;
        }
        case TRANSACTION_onWarmupCompleted:
        {
          data.enforceInterface(descriptor);
          android.os.Bundle _arg0;
          if ((0!=data.readInt())) {
            _arg0 = android.os.Bundle.CREATOR.createFromParcel(data);
          }
          else {
            _arg0 = null;
          }
          this.onWarmupCompleted(_arg0);
          return true;
        }
        case TRANSACTION_onActivityLayout:
        {
          data.enforceInterface(descriptor);
          int _arg0;
          _arg0 = data.readInt();
          int _arg1;
          _arg1 = data.readInt();
          int _arg2;
          _arg2 = data.readInt();
          int _arg3;
          _arg3 = data.readInt();
          int _arg4;
          _arg4 = data.readInt();
          android.os.Bundle _arg5;
          if ((0!=data.readInt())) {
            _arg5 = android.os.Bundle.CREATOR.createFromParcel(data);
          }
          else {
            _arg5 = null;
          }
          this.onActivityLayout(_arg0, _arg1, _arg2, _arg3, _arg4, _arg5);
          return true;
        }
        case TRANSACTION_onMinimized:
        {
          data.enforceInterface(descriptor);
          android.os.Bundle _arg0;
          if ((0!=data.readInt())) {
            _arg0 = android.os.Bundle.CREATOR.createFromParcel(data);
          }
          else {
            _arg0 = null;
          }
          this.onMinimized(_arg0);
          return true;
        }
        case TRANSACTION_onUnminimized:
        {
          data.enforceInterface(descriptor);
          android.os.Bundle _arg0;
          if ((0!=data.readInt())) {
            _arg0 = android.os.Bundle.CREATOR.createFromParcel(data);
          }
          else {
            _arg0 = null;
          }
          this.onUnminimized(_arg0);
          return true;
        }
        default:
        {
          return super.onTransact(code, data, reply, flags);
        }
      }
    }
    private static class Proxy implements android.support.customtabs.ICustomTabsCallback
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
      @Override public void onNavigationEvent(int navigationEvent, android.os.Bundle extras) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeInt(navigationEvent);
          if ((extras!=null)) {
            _data.writeInt(1);
            extras.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          boolean _status = mRemote.transact(Stub.TRANSACTION_onNavigationEvent, _data, null, android.os.IBinder.FLAG_ONEWAY);
          if (!_status && getDefaultImpl() != null) {
            getDefaultImpl().onNavigationEvent(navigationEvent, extras);
            return;
          }
        }
        finally {
          _data.recycle();
        }
      }
      @Override public void extraCallback(java.lang.String callbackName, android.os.Bundle args) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeString(callbackName);
          if ((args!=null)) {
            _data.writeInt(1);
            args.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          boolean _status = mRemote.transact(Stub.TRANSACTION_extraCallback, _data, null, android.os.IBinder.FLAG_ONEWAY);
          if (!_status && getDefaultImpl() != null) {
            getDefaultImpl().extraCallback(callbackName, args);
            return;
          }
        }
        finally {
          _data.recycle();
        }
      }
      // Not defined with 'oneway' to preserve the calling order among |onPostMessage()| and related calls.

      @Override public void onMessageChannelReady(android.os.Bundle extras) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          if ((extras!=null)) {
            _data.writeInt(1);
            extras.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          boolean _status = mRemote.transact(Stub.TRANSACTION_onMessageChannelReady, _data, _reply, 0);
          if (!_status && getDefaultImpl() != null) {
            getDefaultImpl().onMessageChannelReady(extras);
            return;
          }
          _reply.readException();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
      }
      @Override public void onPostMessage(java.lang.String message, android.os.Bundle extras) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeString(message);
          if ((extras!=null)) {
            _data.writeInt(1);
            extras.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          boolean _status = mRemote.transact(Stub.TRANSACTION_onPostMessage, _data, _reply, 0);
          if (!_status && getDefaultImpl() != null) {
            getDefaultImpl().onPostMessage(message, extras);
            return;
          }
          _reply.readException();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
      }
      @Override public void onRelationshipValidationResult(int relation, android.net.Uri origin, boolean result, android.os.Bundle extras) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeInt(relation);
          if ((origin!=null)) {
            _data.writeInt(1);
            origin.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          _data.writeInt(((result)?(1):(0)));
          if ((extras!=null)) {
            _data.writeInt(1);
            extras.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          boolean _status = mRemote.transact(Stub.TRANSACTION_onRelationshipValidationResult, _data, null, android.os.IBinder.FLAG_ONEWAY);
          if (!_status && getDefaultImpl() != null) {
            getDefaultImpl().onRelationshipValidationResult(relation, origin, result, extras);
            return;
          }
        }
        finally {
          _data.recycle();
        }
      }
      // API with return value cannot be 'oneway'.

      @Override public android.os.Bundle extraCallbackWithResult(java.lang.String callbackName, android.os.Bundle args) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        android.os.Bundle _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeString(callbackName);
          if ((args!=null)) {
            _data.writeInt(1);
            args.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          boolean _status = mRemote.transact(Stub.TRANSACTION_extraCallbackWithResult, _data, _reply, 0);
          if (!_status && getDefaultImpl() != null) {
            return getDefaultImpl().extraCallbackWithResult(callbackName, args);
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
      @Override public void onActivityResized(int height, int width, android.os.Bundle extras) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeInt(height);
          _data.writeInt(width);
          if ((extras!=null)) {
            _data.writeInt(1);
            extras.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          boolean _status = mRemote.transact(Stub.TRANSACTION_onActivityResized, _data, null, android.os.IBinder.FLAG_ONEWAY);
          if (!_status && getDefaultImpl() != null) {
            getDefaultImpl().onActivityResized(height, width, extras);
            return;
          }
        }
        finally {
          _data.recycle();
        }
      }
      @Override public void onWarmupCompleted(android.os.Bundle extras) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          if ((extras!=null)) {
            _data.writeInt(1);
            extras.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          boolean _status = mRemote.transact(Stub.TRANSACTION_onWarmupCompleted, _data, null, android.os.IBinder.FLAG_ONEWAY);
          if (!_status && getDefaultImpl() != null) {
            getDefaultImpl().onWarmupCompleted(extras);
            return;
          }
        }
        finally {
          _data.recycle();
        }
      }
      @Override public void onActivityLayout(int left, int top, int right, int bottom, int state, android.os.Bundle extras) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeInt(left);
          _data.writeInt(top);
          _data.writeInt(right);
          _data.writeInt(bottom);
          _data.writeInt(state);
          if ((extras!=null)) {
            _data.writeInt(1);
            extras.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          boolean _status = mRemote.transact(Stub.TRANSACTION_onActivityLayout, _data, null, android.os.IBinder.FLAG_ONEWAY);
          if (!_status && getDefaultImpl() != null) {
            getDefaultImpl().onActivityLayout(left, top, right, bottom, state, extras);
            return;
          }
        }
        finally {
          _data.recycle();
        }
      }
      @Override public void onMinimized(android.os.Bundle extras) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          if ((extras!=null)) {
            _data.writeInt(1);
            extras.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          boolean _status = mRemote.transact(Stub.TRANSACTION_onMinimized, _data, null, android.os.IBinder.FLAG_ONEWAY);
          if (!_status && getDefaultImpl() != null) {
            getDefaultImpl().onMinimized(extras);
            return;
          }
        }
        finally {
          _data.recycle();
        }
      }
      @Override public void onUnminimized(android.os.Bundle extras) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          if ((extras!=null)) {
            _data.writeInt(1);
            extras.writeToParcel(_data, 0);
          }
          else {
            _data.writeInt(0);
          }
          boolean _status = mRemote.transact(Stub.TRANSACTION_onUnminimized, _data, null, android.os.IBinder.FLAG_ONEWAY);
          if (!_status && getDefaultImpl() != null) {
            getDefaultImpl().onUnminimized(extras);
            return;
          }
        }
        finally {
          _data.recycle();
        }
      }
      public static android.support.customtabs.ICustomTabsCallback sDefaultImpl;
    }
    static final int TRANSACTION_onNavigationEvent = (android.os.IBinder.FIRST_CALL_TRANSACTION + 1);
    static final int TRANSACTION_extraCallback = (android.os.IBinder.FIRST_CALL_TRANSACTION + 2);
    static final int TRANSACTION_onMessageChannelReady = (android.os.IBinder.FIRST_CALL_TRANSACTION + 3);
    static final int TRANSACTION_onPostMessage = (android.os.IBinder.FIRST_CALL_TRANSACTION + 4);
    static final int TRANSACTION_onRelationshipValidationResult = (android.os.IBinder.FIRST_CALL_TRANSACTION + 5);
    static final int TRANSACTION_extraCallbackWithResult = (android.os.IBinder.FIRST_CALL_TRANSACTION + 6);
    static final int TRANSACTION_onActivityResized = (android.os.IBinder.FIRST_CALL_TRANSACTION + 7);
    static final int TRANSACTION_onWarmupCompleted = (android.os.IBinder.FIRST_CALL_TRANSACTION + 8);
    static final int TRANSACTION_onActivityLayout = (android.os.IBinder.FIRST_CALL_TRANSACTION + 9);
    static final int TRANSACTION_onMinimized = (android.os.IBinder.FIRST_CALL_TRANSACTION + 10);
    static final int TRANSACTION_onUnminimized = (android.os.IBinder.FIRST_CALL_TRANSACTION + 11);
    public static boolean setDefaultImpl(android.support.customtabs.ICustomTabsCallback impl) {
      if (Stub.Proxy.sDefaultImpl == null && impl != null) {
        Stub.Proxy.sDefaultImpl = impl;
        return true;
      }
      return false;
    }
    public static android.support.customtabs.ICustomTabsCallback getDefaultImpl() {
      return Stub.Proxy.sDefaultImpl;
    }
  }
  public void onNavigationEvent(int navigationEvent, android.os.Bundle extras) throws android.os.RemoteException;
  public void extraCallback(java.lang.String callbackName, android.os.Bundle args) throws android.os.RemoteException;
  // Not defined with 'oneway' to preserve the calling order among |onPostMessage()| and related calls.

  public void onMessageChannelReady(android.os.Bundle extras) throws android.os.RemoteException;
  public void onPostMessage(java.lang.String message, android.os.Bundle extras) throws android.os.RemoteException;
  public void onRelationshipValidationResult(int relation, android.net.Uri origin, boolean result, android.os.Bundle extras) throws android.os.RemoteException;
  // API with return value cannot be 'oneway'.

  public android.os.Bundle extraCallbackWithResult(java.lang.String callbackName, android.os.Bundle args) throws android.os.RemoteException;
  public void onActivityResized(int height, int width, android.os.Bundle extras) throws android.os.RemoteException;
  public void onWarmupCompleted(android.os.Bundle extras) throws android.os.RemoteException;
  public void onActivityLayout(int left, int top, int right, int bottom, int state, android.os.Bundle extras) throws android.os.RemoteException;
  public void onMinimized(android.os.Bundle extras) throws android.os.RemoteException;
  public void onUnminimized(android.os.Bundle extras) throws android.os.RemoteException;
}
