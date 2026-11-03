import { createTheme } from '@mui/material/styles';
export const theme=createTheme({
  palette:{
    mode:'light',
    primary:{main:'#526d80',dark:'#425c6f',light:'#eaf0f3'},
    background:{default:'#f5f7f8',paper:'#ffffff'},
    text:{primary:'#243b4e',secondary:'#738292'},
    divider:'#dfe6eb'
  },
  typography:{fontFamily:'"Inter","Segoe UI", Roboto, Arial, sans-serif',fontSize:14,htmlFontSize:16,body1:{fontSize:14},body2:{fontSize:13},caption:{fontSize:12},button:{textTransform:'none',fontSize:14}},
  shape:{borderRadius:12},
  components:{MuiCssBaseline:{styleOverrides:{body:{margin:0}}},MuiPaper:{styleOverrides:{root:{backgroundImage:'none'}}}}
});
