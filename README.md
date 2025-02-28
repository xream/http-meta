# HTTP META

## 社群

👏🏻 欢迎加入社群进行交流讨论

👥 群组 [折腾啥(群组)](https://t.me/zhetengsha_group)

📢 频道 [折腾啥(频道)](https://t.me/zhetengsha)

## Ecosystem

以下版本均已内置 `http-meta`:

[Sub-Store Android 模块](https://t.me/zhetengsha/1008)

[Sub-Store Docker 版](https://hub.docker.com/r/xream/sub-store)

~~[Sub-Store Hugging Face 版](https://www.notion.so/xream/Sub-Store-Hugging-Face-1787ae7c38df482eaeccea4e0f1d3a8d)~~

[GUI.for.Cores 维护的插件](https://t.me/GUI_for_Cores_Channel/184)

## Usage

> ⚠️ If a proxy is already running on the device running `http-meta`, you may need to exclude the `http-meta` process.

## The Easy Way(for example, on an Android device)

Create a folder `/data/http-meta`

Download [http-meta.bundle.js](https://github.com/xream/http-meta/releases/latest/download/http-meta.bundle.js), rename it to `http-meta.bundle.js`and move it to the `/data/http-meta` folder.

Create a folder `/data/http-meta/meta`

Download [Meta](https://github.com/MetaCubeX/mihomo/releases), rename it to `http-meta` and move it to the `/data/http-meta/meta` folder.

Download [tpl.yaml](https://github.com/xream/http-meta/releases/latest/download/tpl.yaml), rename it to `tpl.yaml` and move it to the `/data/http-meta/meta` folder.

> `META_FOLDER` can be the absolute path of the `meta` folder if neccessary.

> `META_TEMP_FOLDER` can be the absolute path of the temp folder if neccessary. Defaults to the default directory for temporary files of the operating system. This path may have to be provided in the Android environment.

`META_TEMP_FOLDER=/data/http-meta META_FOLDER=/data/http-meta/meta HOST=127.0.0.1 PORT=9876 node http-meta.bundle.js`

## The Hard Way

`cd /data`

`git clone https://github.com/xream/http-meta.git http-meta`

`cd /data/http-meta`

Download [Meta](https://github.com/MetaCubeX/mihomo/releases), rename it to `http-meta` and move it to the `/data/http-meta/meta` folder.

`cd /data/http-meta`

`pnpm i`

> `META_FOLDER` can be the absolute path of the `meta` folder if neccessary.

> `META_TEMP_FOLDER` can be the absolute path of the temp folder if neccessary. Defaults to the default directory for temporary files of the operating system. This path may have to be provided in the Android environment.

`META_TEMP_FOLDER=/data/http-meta META_FOLDER=/data/http-meta/meta HOST=127.0.0.1 PORT=9876 pnpm start`

## Authorization

Set the `AUTHORIZATION` environment variable to enable authorization.

Add the `Authorization` header to the request.

## Available Port

Environment variables `META_MAX_AVAILABLE_PORT` and `META_MIN_AVAILABLE_PORT` can be set to customize the available port range.

## Disable Auto Clean & Set Custom Temp Folder

Environment variable `META_DISABLE_AUTO_CLEAN` can be set to `true` to disable the auto clean feature.

Environment variable `META_TEMP_FOLDER` can be set to customize the temp folder.

This is helpful when you need to keep logs and configuration files in a temporary folder for debugging purposes.

## Test

```console
curl '127.0.0.1:9876/test'
```

### Response

```JSON
{
    "pid": 35955,
    "log":"INFO Mixed(http+socks)[listener-proxy-0] proxy listening at: [::]:65535",
    "config": "bind-address: 0.0.0.0\nallow-lan: true"
}
```

## Start (always start a new one)

```console
curl '127.0.0.1:9876/start' \
--header 'Content-Type: application/json' \
--data '{
    "timeout": 1800000, // process will be killed after 30 minutes(default)
    "proxies": [
        {
            "name": "1",
            "server": "1.2.3.4",
            "port": 80,
            "type": "vmess",
            ...
        }
    ]
}'
```

### Response

```JSON
{
    "ports": [
        65534,
        65533
    ],
    "pid": 61289
}
```

## Retart(stop all and start a new one)

```console
curl '127.0.0.1:9876/start' \
--header 'Content-Type: application/json' \
--data '{
    "timeout": 1800000, // process will be killed after 30 minutes(default)
    "proxies": [
        {
            "name": "1",
            "server": "1.2.3.4",
            "port": 80,
            "type": "vmess",
            ...
        },
          {
            "name": "2",
            "server": "1.2.3.4",
            "port": 80,
            "type": "vmess",
            ...
        }
    ]
}'
```

### Response

```JSON
{
    "ports": [
        65534,
        65533
    ],
    "pid": 61289
}
```

## Stop

### Stop All

```console
curl --request POST '127.0.0.1:9876/stop'
```

### Stop by PID

```console
curl '127.0.0.1:9876/stop' \
--header 'Content-Type: application/json' \
--data '{
    "pid": [
        1,
        2
    ]
}'
```

### Response

```JSON
{
    "pid": null
}
```

## Get Stats

```console
curl '127.0.0.1:9876/stats' \
--header 'Content-Type: application/json'
```

### Response

```JSON
{
    "35955": {
        "pid": 35955,
        "mem": "2MB",
        "cpu": "0%"
    }
}
```

## Get Stats by PID

```console
curl '127.0.0.1:9876/stats' \
--header 'Content-Type: application/json' \
--data '{"pid": [35955]}'
```

### Response

```JSON
{
    "35955": {
        "pid": 35955,
        "ports": [
            65534,
            65533
        ],
        "mem": "2MB",
        "cpu": "0%"
    }
}
```

## UDP Test(NTP via Proxy)

`port`: proxy port

`ntp`: ntp server(default: `time.apple.com`)

`timeout`: timeout(default: `3000`ms)

```console
curl '127.0.0.1:9876/udp' \
--header 'Content-Type: application/json' \
--data '{
    "port": 35955,
    "ntp": "time.apple.com",
    "timeout": 2000
}'
```

### Response

```JSON
{
    "data": "ok"
}
```
