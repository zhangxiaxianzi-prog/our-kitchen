// 云托管环境在每次调用里明确指定，手机只保存登录票据，不保存共享库存。
App({
  onLaunch() {
    if (wx.cloud) wx.cloud.init();
  }
});
