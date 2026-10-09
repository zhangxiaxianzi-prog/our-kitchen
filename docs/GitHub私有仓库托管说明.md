# GitHub私有仓库托管说明

## 托管范围

将桌面“两人厨房”项目的当前main分支及已有提交历史上传到用户的GitHub账号，仓库设置为私有。不上传手机或数据库中的厨房记录、不上传本地环境密钥，不创建公开仓库。

## 仓库信息

- GitHub账号：zhangxiaxianzi-prog。
- 仓库：https://github.com/zhangxiaxianzi-prog/our-kitchen。
- 可见性：私有，已通过GitHub接口核对isPrivate为true、visibility为PRIVATE。
- 上传分支：main。上传后核对远程提交编号与本地一致。
- 本地项目：/Users/admin/Desktop/两人厨房。

## 与微信部署的关系

仓库存储网站、小程序和微信云托管接入服务的代码，云托管服务代码目录为wechat-gateway，Dockerfile位于该目录，应用监听8080端口。

用户提供的微信部署截图提示“私有仓库请使用CLI工具”。保持仓库私有，不为适配部署页面改成公开；当前继续使用已交付的微信云托管服务包进行本地代码上传。

GitHub代码托管成功不表示微信云托管发布成功，也不表示小程序审核或发布成功。

## 后续更新

在桌面原项目的当前分支修改和提交，通过已配置的GitHub远程仓库上传。共享厨房的登录密钥仍由原Sites网站管理，不放入GitHub代码。
